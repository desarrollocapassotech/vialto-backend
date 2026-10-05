/**
 * Pruebas de planes de mantenimiento (MANT-02-T1): reglas, plantillas y CRUD con Prisma mockeado.
 * Ejecutar: npm run test:mant-planes
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlanesService, assertReglasPlan, type ReglasPlan } from './planes.service';
import { PLANTILLAS_PLAN } from './plantillas-plan.const';
import { TAREAS_MANTENIMIENTO_VALIDAS } from './tareas-mantenimiento.const';
import type { PrismaService } from '../../shared/prisma/prisma.service';

let fallos = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

// ── Mock de Prisma en memoria ──
type Row = Record<string, any>;
function coincide(r: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('equals' in v) return String(r[k]).toLowerCase() === String(v.equals).toLowerCase();
      if ('not' in v) return r[k] !== v.not;
      if ('in' in v) return v.in.includes(r[k]);
    }
    return r[k] === v;
  });
}
function crearPrisma(planesIniciales: Row[] = [], asignaciones: Row[] = []) {
  const planes = [...planesIniciales];
  let n = 0;
  const conCount = (p: Row) => ({ ...p, _count: { vehiculos: asignaciones.filter((a) => a.planId === p.id && a.activo).length } });
  const client: Row = {
    planMantenimiento: {
      findMany: async ({ where }: Row) => planes.filter((p) => coincide(p, where)).map(conCount),
      findFirst: async ({ where }: Row) => {
        const p = planes.find((x) => coincide(x, where));
        return p ? conCount(p) : null;
      },
      create: async ({ data }: Row) => {
        const p = { id: `p${++n}`, ...data };
        planes.push(p);
        return conCount(p);
      },
      createMany: async ({ data }: Row) => {
        for (const d of data) planes.push({ id: `p${++n}`, activo: true, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: Row) => {
        const hits = planes.filter((p) => coincide(p, where));
        hits.forEach((p) => Object.assign(p, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: Row) => {
        const antes = planes.length;
        for (let i = planes.length - 1; i >= 0; i--) if (coincide(planes[i], where)) planes.splice(i, 1);
        return { count: antes - planes.length };
      },
    },
    vehiculoPlan: { count: async ({ where }: Row) => asignaciones.filter((a) => coincide(a, where)).length },
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  return { prisma: client as unknown as PrismaService, planes };
}

const T = 'org_A';
const valido: ReglasPlan = { categoria: 'mecanico', intervaloKm: 10_000, intervaloDias: null, avisoKm: 1_000, avisoDias: null, tareas: ['engrasado_chasis'] };
const planExistente = (o: Row = {}) => ({
  id: 'px', tenantId: T, nombre: 'VTV/RTO', categoria: 'documental', tipoVehiculo: null, intervaloKm: null,
  intervaloDias: 365, avisoKm: null, avisoDias: 30, tareas: [], activo: true, createdBy: 'u', ...o,
});

(async () => {
  // ── Reglas ──
  await test('reglas: plan válido pasa', () => assertReglasPlan(valido));
  await test('reglas: sin intervalos → 400', () =>
    assert.throws(() => assertReglasPlan({ ...valido, intervaloKm: null, avisoKm: null }), BadRequestException));
  await test('reglas: aviso en km sin intervalo en km → 400', () =>
    assert.throws(() => assertReglasPlan({ ...valido, intervaloKm: null, intervaloDias: 30 }), BadRequestException));
  await test('reglas: aviso en días sin intervalo en días → 400', () =>
    assert.throws(() => assertReglasPlan({ ...valido, avisoDias: 5 }), BadRequestException));
  await test('reglas: aviso ≥ intervalo → 400', () =>
    assert.throws(() => assertReglasPlan({ ...valido, avisoKm: 10_000 }), BadRequestException));
  await test('reglas: mecánico sin tareas → 400', () =>
    assert.throws(() => assertReglasPlan({ ...valido, tareas: [] }), BadRequestException));
  await test('reglas: documental sin tareas pasa', () =>
    assertReglasPlan({ categoria: 'documental', intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 30, tareas: [] }));

  // ── Plantillas ──
  await test('todas las plantillas cumplen las reglas y usan tareas del catálogo', () => {
    assert.equal(PLANTILLAS_PLAN.length, 9);
    for (const t of PLANTILLAS_PLAN) {
      assertReglasPlan(t);
      for (const tarea of t.tareas) assert.ok((TAREAS_MANTENIMIENTO_VALIDAS as readonly string[]).includes(tarea), tarea);
    }
    assert.equal(new Set(PLANTILLAS_PLAN.map((t) => t.nombre.toLowerCase())).size, 9, 'nombres únicos');
  });

  await test('plantillas: primera corrida crea 9, segunda 0', async () => {
    const { prisma, planes } = crearPrisma();
    const svc = new PlanesService(prisma);
    const r1 = await svc.crearPlantillas(T, 'u1');
    assert.equal(r1.creados.length, 9);
    assert.ok(planes.every((p) => p.tipoVehiculo === null && p.tenantId === T && p.createdBy === 'u1'));
    const r2 = await svc.crearPlantillas(T, 'u1');
    assert.deepEqual([r2.creados.length, r2.existentes.length, planes.length], [0, 9, 9]);
  });

  await test('plantillas: no duplica una existente con otro casing (aunque esté inactiva)', async () => {
    const { prisma, planes } = crearPrisma([planExistente({ nombre: 'vtv/rto', activo: false })]);
    const r = await new PlanesService(prisma).crearPlantillas(T, 'u1');
    assert.deepEqual([r.creados.length, r.existentes, planes.length], [8, ['VTV/RTO'], 9]);
  });

  await test('plantillas: los planes de otro tenant no cuentan', async () => {
    const { prisma } = crearPrisma([planExistente({ tenantId: 'org_B' })]);
    const r = await new PlanesService(prisma).crearPlantillas(T, 'u1');
    assert.equal(r.creados.length, 9);
  });

  // ── CRUD ──
  const dtoBase = { nombre: ' Service 20.000 ', categoria: 'mecanico', intervaloKm: 20_000, tareas: ['cambio_aceite_motor'] };

  await test('create: guarda con trim y defaults', async () => {
    const { prisma } = crearPrisma();
    const p = await new PlanesService(prisma).create(T, 'u1', dtoBase);
    assert.deepEqual([p.nombre, p.tipoVehiculo, p.intervaloDias, p.activo, p._count.vehiculos], ['Service 20.000', null, null, true, 0]);
  });

  await test('create: nombre repetido con otro casing → 409', async () => {
    const { prisma } = crearPrisma([planExistente()]);
    await assert.rejects(
      new PlanesService(prisma).create(T, 'u1', { nombre: 'vtv/rto', categoria: 'documental', intervaloDias: 365 }),
      ConflictException,
    );
  });

  await test('create: mismo nombre en otro tenant está permitido', async () => {
    const { prisma } = crearPrisma([planExistente({ tenantId: 'org_B' })]);
    await new PlanesService(prisma).create(T, 'u1', { nombre: 'VTV/RTO', categoria: 'documental', intervaloDias: 365 });
  });

  await test('update: combina con lo guardado y valida el estado final', async () => {
    const { prisma } = crearPrisma([planExistente()]);
    const svc = new PlanesService(prisma);
    const p = await svc.update(T, 'px', { avisoDias: 45, activo: false });
    assert.deepEqual([p.avisoDias, p.activo, p.intervaloDias], [45, false, 365]);
    await assert.rejects(svc.update(T, 'px', { intervaloDias: null }), BadRequestException); // queda sin intervalos
  });

  await test('update: null borra el aviso', async () => {
    const { prisma } = crearPrisma([planExistente()]);
    const p = await new PlanesService(prisma).update(T, 'px', { avisoDias: null });
    assert.equal(p.avisoDias, null);
  });

  await test('update: renombrar a un nombre ocupado → 409; mismo nombre con otro casing → OK', async () => {
    const { prisma } = crearPrisma([planExistente(), planExistente({ id: 'py', nombre: 'RUTA' })]);
    const svc = new PlanesService(prisma);
    await assert.rejects(svc.update(T, 'py', { nombre: 'vtv/rto' }), ConflictException);
    const p = await svc.update(T, 'px', { nombre: 'vtv/RTO' });
    assert.equal(p.nombre, 'vtv/RTO');
  });

  await test('plan de otro tenant → 404 en get/update/delete', async () => {
    const { prisma } = crearPrisma([planExistente({ tenantId: 'org_B' })]);
    const svc = new PlanesService(prisma);
    await assert.rejects(svc.findOne(T, 'px'), NotFoundException);
    await assert.rejects(svc.update(T, 'px', { activo: false }), NotFoundException);
    await assert.rejects(svc.remove(T, 'px'), NotFoundException);
  });

  await test('delete: con unidades asignadas → 409; sin asignaciones → borra', async () => {
    const { prisma, planes } = crearPrisma(
      [planExistente(), planExistente({ id: 'py', nombre: 'RUTA' })],
      [{ tenantId: T, planId: 'px', activo: false }],
    );
    const svc = new PlanesService(prisma);
    await assert.rejects(svc.remove(T, 'px'), ConflictException);
    await svc.remove(T, 'py');
    assert.deepEqual(planes.map((p) => p.id), ['px']);
  });

  await test('findAll filtra por tenant, categoría y activo', async () => {
    const { prisma } = crearPrisma([
      planExistente(),
      planExistente({ id: 'p2', nombre: 'Engrase', categoria: 'mecanico', activo: false }),
      planExistente({ id: 'p3', tenantId: 'org_B' }),
    ]);
    const svc = new PlanesService(prisma);
    assert.equal((await svc.findAll(T, {})).length, 2);
    assert.equal((await svc.findAll(T, { categoria: 'mecanico' })).length, 1);
    assert.equal((await svc.findAll(T, { activo: 'true' })).length, 1);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
