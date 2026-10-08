/**
 * Pruebas de la asignación plan ↔ unidad (MANT-02-T2), con Prisma mockeado en memoria.
 * Ejecutar: npm run test:mant-asignaciones
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AsignacionesService, parseBaseFecha } from './asignaciones.service';
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

type Row = Record<string, any>;
function coincide(r: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'in' in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
}

const T = 'org_A';
const HOY = new Date('2026-10-05T15:00:00Z');

function crearPrisma(opts: { planes?: Row[]; vehiculos?: Row[]; asignaciones?: Row[]; otPlanes?: Row[] } = {}) {
  const planes = opts.planes ?? [{ id: 'p1', tenantId: T, activo: true, nombre: 'Service' }];
  const vehiculos = opts.vehiculos ?? [
    { id: 'v1', tenantId: T, patente: 'AAA', tipo: 'tractor' },
    { id: 'v2', tenantId: T, patente: 'BBB', tipo: 'tractor' },
    { id: 'v3', tenantId: T, patente: 'CCC', tipo: 'camion' },
    { id: 'vB', tenantId: 'org_B', patente: 'ZZZ', tipo: 'tractor' },
  ];
  const asignaciones: Row[] = opts.asignaciones ?? [];
  const otPlanes = opts.otPlanes ?? [];
  let n = 0;
  const conVehiculo = (a: Row) => ({ ...a, vehiculo: vehiculos.find((v) => v.id === a.vehiculoId) });
  const client: Row = {
    planMantenimiento: { findFirst: async ({ where }: Row) => planes.find((p) => coincide(p, where)) ?? null },
    vehiculo: {
      findMany: async ({ where }: Row) => vehiculos.filter((v) => coincide(v, where)),
      findFirst: async ({ where }: Row) => vehiculos.find((v) => coincide(v, where)) ?? null,
    },
    vehiculoPlan: {
      findMany: async ({ where }: Row) => asignaciones.filter((a) => coincide(a, where)).map(conVehiculo),
      findFirst: async ({ where }: Row) => {
        const a = asignaciones.find((x) => coincide(x, where));
        return a ? conVehiculo(a) : null;
      },
      createMany: async ({ data }: Row) => {
        for (const d of data) asignaciones.push({ id: `vp${++n}`, activo: true, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: Row) => {
        const hits = asignaciones.filter((a) => coincide(a, where));
        hits.forEach((a) => Object.assign(a, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: Row) => {
        const antes = asignaciones.length;
        for (let i = asignaciones.length - 1; i >= 0; i--) if (coincide(asignaciones[i], where)) asignaciones.splice(i, 1);
        return { count: antes - asignaciones.length };
      },
    },
    ordenTrabajoPlan: { count: async ({ where }: Row) => otPlanes.filter((o) => coincide(o, where)).length },
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  return { svc: new AsignacionesService(client as unknown as PrismaService), asignaciones };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : d);

(async () => {
  await test('base común: crea las unidades con la misma base (fecha a 00:00 UTC)', async () => {
    const { svc, asignaciones } = crearPrisma();
    const r = await svc.asignar(T, 'p1', { vehiculoIds: ['v1', 'v2'], baseKm: 480_000, baseFecha: '2026-08-15T18:30:00Z' }, HOY);
    assert.equal(r.creados.length, 2);
    assert.ok(asignaciones.every((a) => a.baseKm === 480_000 && iso(a.baseFecha) === '2026-08-15T00:00:00.000Z' && a.tenantId === T));
    assert.equal(r.creados[0].vehiculo.patente, 'AAA');
  });

  await test('base por unidad: cada una con la suya', async () => {
    const { svc, asignaciones } = crearPrisma();
    await svc.asignar(T, 'p1', {
      vehiculos: [
        { vehiculoId: 'v1', baseKm: 100, baseFecha: '2026-01-01' },
        { vehiculoId: 'v2', baseKm: 200 },
      ],
    }, HOY);
    assert.deepEqual(asignaciones.map((a) => [a.vehiculoId, a.baseKm, iso(a.baseFecha)]), [
      ['v1', 100, '2026-01-01T00:00:00.000Z'],
      ['v2', 200, null],
    ]);
  });

  await test('las dos formas juntas o ninguna → 400', async () => {
    const { svc } = crearPrisma();
    await assert.rejects(svc.asignar(T, 'p1', { vehiculoIds: ['v1'], vehiculos: [{ vehiculoId: 'v2' }] }, HOY), BadRequestException);
    await assert.rejects(svc.asignar(T, 'p1', {}, HOY), BadRequestException);
  });

  await test('unidad repetida en la forma por unidad → 400', async () => {
    const { svc } = crearPrisma();
    await assert.rejects(svc.asignar(T, 'p1', { vehiculos: [{ vehiculoId: 'v1' }, { vehiculoId: 'v1' }] }, HOY), BadRequestException);
  });

  await test('unidad de otro tenant → 400 y no crea nada', async () => {
    const { svc, asignaciones } = crearPrisma();
    await assert.rejects(svc.asignar(T, 'p1', { vehiculoIds: ['v1', 'vB'] }, HOY), BadRequestException);
    assert.equal(asignaciones.length, 0);
  });

  await test('plan de otro tenant → 404; plan desactivado → 400', async () => {
    const { svc } = crearPrisma({ planes: [{ id: 'p1', tenantId: 'org_B', activo: true }, { id: 'p2', tenantId: T, activo: false }] });
    await assert.rejects(svc.asignar(T, 'p1', { vehiculoIds: ['v1'] }, HOY), NotFoundException);
    await assert.rejects(svc.asignar(T, 'p2', { vehiculoIds: ['v1'] }, HOY), BadRequestException);
  });

  await test('mezcla: nueva se crea, activa se ignora (base intacta), inactiva se reactiva con la base nueva', async () => {
    const { svc, asignaciones } = crearPrisma({
      asignaciones: [
        { id: 'a1', tenantId: T, planId: 'p1', vehiculoId: 'v1', activo: true, baseKm: 1, baseFecha: null },
        { id: 'a2', tenantId: T, planId: 'p1', vehiculoId: 'v2', activo: false, baseKm: 2, baseFecha: null },
      ],
    });
    const r = await svc.asignar(T, 'p1', { vehiculoIds: ['v1', 'v2', 'v3'], baseKm: 999 }, HOY);
    assert.deepEqual(r.yaAsignados, ['v1']);
    assert.deepEqual(r.reactivados.map((a: Row) => a.id), ['a2']);
    assert.deepEqual(r.creados.map((a: Row) => a.vehiculoId), ['v3']);
    const porId = Object.fromEntries(asignaciones.map((a) => [a.vehiculoId, a]));
    assert.deepEqual([porId.v1.baseKm, porId.v2.baseKm, porId.v2.activo, porId.v3.baseKm], [1, 999, true, 999]);
  });

  await test('reactivar sin base en el pedido conserva la base guardada', async () => {
    const { svc, asignaciones } = crearPrisma({
      asignaciones: [{ id: 'a2', tenantId: T, planId: 'p1', vehiculoId: 'v2', activo: false, baseKm: 2, baseFecha: null }],
    });
    await svc.asignar(T, 'p1', { vehiculoIds: ['v2'] }, HOY);
    assert.deepEqual([asignaciones[0].activo, asignaciones[0].baseKm], [true, 2]);
  });

  await test('fecha base futura → 400; hoy está permitido', async () => {
    assert.throws(() => parseBaseFecha('2026-10-06', HOY), BadRequestException);
    assert.equal(iso(parseBaseFecha('2026-10-05', HOY) as Date), '2026-10-05T00:00:00.000Z');
    const { svc } = crearPrisma();
    await assert.rejects(svc.asignar(T, 'p1', { vehiculoIds: ['v1'], baseFecha: '2027-01-01' }, HOY), BadRequestException);
  });

  await test('PATCH: null borra la base, activo se cambia; de otro tenant → 404', async () => {
    const { svc, asignaciones } = crearPrisma({
      asignaciones: [
        { id: 'a1', tenantId: T, planId: 'p1', vehiculoId: 'v1', activo: true, baseKm: 5, baseFecha: new Date('2026-01-01T00:00:00Z') },
        { id: 'aB', tenantId: 'org_B', planId: 'pB', vehiculoId: 'vB', activo: true, baseKm: 5, baseFecha: null },
      ],
    });
    const r = await svc.update(T, 'a1', { baseKm: null, activo: false }, HOY);
    assert.deepEqual([r.baseKm, iso(r.baseFecha), r.activo], [null, '2026-01-01T00:00:00.000Z', false]);
    await assert.rejects(svc.update(T, 'aB', { activo: false }, HOY), NotFoundException);
    assert.equal(asignaciones[1].activo, true);
  });

  await test('DELETE: con OT que la cumplió → 409; sin OT → borra', async () => {
    const { svc, asignaciones } = crearPrisma({
      asignaciones: [
        { id: 'a1', tenantId: T, planId: 'p1', vehiculoId: 'v1', activo: true },
        { id: 'a2', tenantId: T, planId: 'p1', vehiculoId: 'v2', activo: true },
      ],
      otPlanes: [{ tenantId: T, vehiculoPlanId: 'a1', ordenId: 'o1' }],
    });
    await assert.rejects(svc.remove(T, 'a1'), ConflictException);
    await svc.remove(T, 'a2');
    assert.deepEqual(asignaciones.map((a) => a.id), ['a1']);
  });

  await test('listados: por plan y por unidad, siempre del tenant', async () => {
    const { svc } = crearPrisma({
      asignaciones: [
        { id: 'a1', tenantId: T, planId: 'p1', vehiculoId: 'v1', activo: true },
        { id: 'aB', tenantId: 'org_B', planId: 'p1', vehiculoId: 'vB', activo: true },
      ],
    });
    assert.deepEqual((await svc.listarPorPlan(T, 'p1')).map((a: Row) => a.id), ['a1']);
    await assert.rejects(svc.listarPorVehiculo(T, 'vB'), NotFoundException);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
