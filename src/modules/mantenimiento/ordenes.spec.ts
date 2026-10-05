/**
 * Pruebas de órdenes de trabajo (MANT-02-T4): funciones puras + OrdenesService con Prisma mockeado.
 * Ejecutar: npm run test:mant-ordenes
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service';
import { calcularItems, evaluarKmOrden } from './ordenes.util';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import type { LecturaKm } from '../../core/odometro/odometro.types';
import type { OdometroService } from '../../core/odometro/odometro.service';
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

const d = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
const lec = (km: number, fecha: string, fuente = 'carga', createdAt = fecha): LecturaKm => ({
  km, fecha: d(fecha), fuente, fuenteId: `${fuente}-${km}`, createdAt: d(createdAt),
});

// ── Mock de Prisma ──
type Row = Record<string, any>;
function coincide(r: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'in' in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
}
const T = 'org_A';
const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/vialto/mantenimiento';

function crearMock(opts: { lecturas?: LecturaKm[] } = {}) {
  const db = {
    vehiculos: [
      { id: 'v1', tenantId: T, patente: 'AAA', tipo: 'tractor' },
      { id: 'v2', tenantId: T, patente: 'BBB', tipo: 'tractor' },
      { id: 'vB', tenantId: 'org_B', patente: 'ZZZ', tipo: 'tractor' },
    ] as Row[],
    talleres: [
      { id: 't1', tenantId: T, nombre: 'Norte', activo: true },
      { id: 't2', tenantId: T, nombre: 'Viejo', activo: false },
      { id: 'tB', tenantId: 'org_B', nombre: 'Ajeno', activo: true },
    ] as Row[],
    asignaciones: [
      { id: 'vp1', tenantId: T, vehiculoId: 'v1', planId: 'p1' },
      { id: 'vp2', tenantId: T, vehiculoId: 'v2', planId: 'p1' },
    ] as Row[],
    ordenes: [] as Row[],
    items: [] as Row[],
    otPlanes: [] as Row[],
    secuencia: 0,
  };
  let n = 0;
  const detalle = (o: Row) => ({
    ...o,
    vehiculo: db.vehiculos.find((v) => v.id === o.vehiculoId),
    taller: db.talleres.find((t) => t.id === o.tallerId) ?? null,
    items: db.items.filter((i) => i.ordenId === o.id),
    planes: db.otPlanes.filter((p) => p.ordenId === o.id).map((p) => ({ vehiculoPlanId: p.vehiculoPlanId })),
  });
  const borrar = (lista: Row[], where: Row) => {
    const antes = lista.length;
    for (let i = lista.length - 1; i >= 0; i--) if (coincide(lista[i], where)) lista.splice(i, 1);
    return { count: antes - lista.length };
  };
  const client: Row = {
    vehiculo: { findFirst: async ({ where }: Row) => db.vehiculos.find((v) => coincide(v, where)) ?? null },
    taller: { findFirst: async ({ where }: Row) => db.talleres.find((t) => coincide(t, where)) ?? null },
    vehiculoPlan: { findMany: async ({ where }: Row) => db.asignaciones.filter((a) => coincide(a, where)) },
    ordenTrabajo: {
      findFirst: async ({ where }: Row) => {
        const o = db.ordenes.find((x) => coincide(x, where));
        return o ? detalle(o) : null;
      },
      create: async ({ data }: Row) => {
        const o = { id: `o${++n}`, createdAt: new Date('2026-10-05T12:00:00Z'), ...data };
        db.ordenes.push(o);
        return { id: o.id };
      },
      updateMany: async ({ where, data }: Row) => {
        const hits = db.ordenes.filter((o) => coincide(o, where));
        hits.forEach((o) => Object.assign(o, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: Row) => borrar(db.ordenes, where),
    },
    ordenTrabajoItem: {
      createMany: async ({ data }: Row) => {
        data.forEach((i: Row) => db.items.push({ id: `i${++n}`, ...i }));
        return { count: data.length };
      },
      deleteMany: async ({ where }: Row) => borrar(db.items, where),
    },
    ordenTrabajoPlan: {
      createMany: async ({ data }: Row) => {
        data.forEach((p: Row) => db.otPlanes.push(p));
        return { count: data.length };
      },
      deleteMany: async ({ where }: Row) => borrar(db.otPlanes, where),
      count: async ({ where }: Row) => db.otPlanes.filter((p) => coincide(p, where)).length,
    },
    $queryRaw: async () => [{ lastValue: ++db.secuencia }],
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  const odometro = { getLecturas: async () => opts.lecturas ?? [] } as unknown as OdometroService;
  const svc = new OrdenesService(client as unknown as PrismaService, new CloudinaryService(), odometro);
  return { svc, db };
}

const base = { vehiculoId: 'v1', tipo: 'preventivo', fecha: '2026-10-01' };

(async () => {
  // ── Puros ──
  await test('calcularItems: subtotales redondeados, cantidad por defecto y total', () => {
    const r = calcularItems([
      { descripcion: ' Aceite ', cantidad: 3, costoUnitario: 10.333 },
      { descripcion: 'Mano de obra', costoUnitario: 50000, tipo: 'mano_obra' },
    ]);
    assert.deepEqual(r.items.map((i) => [i.descripcion, i.tipo, i.cantidad, i.subtotal]), [
      ['Aceite', 'general', 3, 31],
      ['Mano de obra', 'mano_obra', 1, 50000],
    ]);
    assert.equal(r.costoTotal, 50031);
  });

  await test('calcularItems sin ítems → total 0', () => {
    assert.deepEqual(calcularItems(undefined), { items: [], costoTotal: 0 });
  });

  const lecturas = [lec(100_000, '2026-09-01T10:00:00Z'), lec(103_000, '2026-10-10T10:00:00Z')];
  await test('km entre las lecturas vecinas → sin aviso', () => {
    assert.equal(evaluarKmOrden({ km: 101_500, fecha: d('2026-09-20') }, lecturas), null);
  });
  await test('sin km o sin lecturas → sin aviso', () => {
    assert.equal(evaluarKmOrden({ km: null, fecha: d('2026-09-20') }, lecturas), null);
    assert.equal(evaluarKmOrden({ km: 1, fecha: d('2026-09-20') }, []), null);
  });
  await test('km menor que la lectura anterior → aviso', () => {
    const w = evaluarKmOrden({ km: 99_000, fecha: d('2026-09-20') }, lecturas);
    assert.match(w ?? '', /menor que la lectura anterior: 100\.000 km el 01\/09\/2026 \(carga de combustible\)/);
  });
  await test('km mayor que la lectura siguiente → aviso', () => {
    const w = evaluarKmOrden({ km: 103_500, fecha: d('2026-09-20') }, lecturas);
    assert.match(w ?? '', /mayor que la lectura siguiente: 103\.000 km el 10\/10\/2026/);
  });
  await test('salto de más de 5.000 km desde la anterior → aviso', () => {
    assert.equal(evaluarKmOrden({ km: 106_000, fecha: d('2026-10-20') }, lecturas), null); // 3.000 km: normal
    assert.equal(evaluarKmOrden({ km: 108_001, fecha: d('2026-10-20') }, lecturas)?.includes('Hay 5.001 km'), true);
    assert.equal(evaluarKmOrden({ km: 108_000, fecha: d('2026-10-20') }, lecturas), null); // justo 5.000: no
  });
  await test('mismo día: la carga de esa mañana cuenta como anterior a una OT nueva', () => {
    const w = evaluarKmOrden(
      { km: 102_000, fecha: d('2026-10-10'), createdAt: d('2026-10-10T18:00:00Z') },
      lecturas,
    );
    assert.match(w ?? '', /menor que la lectura anterior: 103\.000 km el 10\/10\/2026/);
  });

  // ── Service ──
  await test('alta: número por secuencia, total calculado, origen plan, fecha a 00:00 UTC', async () => {
    const { svc, db } = crearMock();
    const o = await svc.create(T, 'u1', {
      ...base,
      fecha: '2026-10-01T15:30:00Z',
      km: 120_000,
      tallerId: 't1',
      items: [{ descripcion: 'Filtro', cantidad: 2, costoUnitario: 1500.5 }],
      vehiculoPlanIds: ['vp1'],
      adjuntos: [`${CLOUD}/${T}/123-factura.jpg`],
    });
    const o2 = await svc.create(T, 'u1', base);
    assert.deepEqual([o.numero, o.costoTotal, o.origen, o.estado, o.fecha.toISOString()], [1, 3001, 'plan', 'cerrada', '2026-10-01T00:00:00.000Z']);
    assert.deepEqual([o2.numero, o2.costoTotal, o2.origen], [2, 0, 'manual']);
    assert.equal(o.warning, null);
    assert.ok(db.items.every((i) => i.tenantId === T) && db.otPlanes.every((p) => p.tenantId === T));
  });

  await test('alta: devuelve warning si el km no cierra', async () => {
    const { svc } = crearMock({ lecturas });
    const o = await svc.create(T, 'u1', { ...base, fecha: '2026-09-20', km: 99_000 });
    assert.match(o.warning ?? '', /menor que la lectura anterior/);
  });

  await test('alta: plan de otra unidad → 400; unidad de otro tenant → 400', async () => {
    const { svc, db } = crearMock();
    await assert.rejects(svc.create(T, 'u1', { ...base, vehiculoPlanIds: ['vp2'] }), BadRequestException);
    await assert.rejects(svc.create(T, 'u1', { ...base, vehiculoId: 'vB' }), BadRequestException);
    assert.equal(db.ordenes.length, 0);
  });

  await test('alta: taller de otro tenant o desactivado → 400', async () => {
    const { svc } = crearMock();
    await assert.rejects(svc.create(T, 'u1', { ...base, tallerId: 'tB' }), BadRequestException);
    await assert.rejects(svc.create(T, 'u1', { ...base, tallerId: 't2' }), BadRequestException);
  });

  await test('alta: adjunto externo o de otro tenant → 400', async () => {
    const { svc } = crearMock();
    await assert.rejects(svc.create(T, 'u1', { ...base, adjuntos: ['https://ejemplo.com/f.pdf'] }), BadRequestException);
    await assert.rejects(svc.create(T, 'u1', { ...base, adjuntos: [`${CLOUD}/org_B/x.jpg`] }), BadRequestException);
  });

  await test('edición: ítems reemplazan la lista y se recalcula el total', async () => {
    const { svc, db } = crearMock();
    const o = await svc.create(T, 'u1', { ...base, items: [{ descripcion: 'A', costoUnitario: 10 }, { descripcion: 'B', costoUnitario: 20 }] });
    const e = await svc.update(T, o.id, { items: [{ descripcion: 'C', cantidad: 4, costoUnitario: 25 }] });
    assert.deepEqual([e.costoTotal, db.items.length, db.items[0].descripcion], [100, 1, 'C']);
  });

  await test('edición: cambiar de unidad con planes de la anterior → 400; con planes nuevos → OK', async () => {
    const { svc, db } = crearMock();
    const o = await svc.create(T, 'u1', { ...base, vehiculoPlanIds: ['vp1'] });
    await assert.rejects(svc.update(T, o.id, { vehiculoId: 'v2' }), BadRequestException);
    const e = await svc.update(T, o.id, { vehiculoId: 'v2', vehiculoPlanIds: ['vp2'] });
    assert.deepEqual([e.vehiculoId, db.otPlanes.map((p) => p.vehiculoPlanId), e.origen], ['v2', ['vp2'], 'plan']);
    const sinPlanes = await svc.update(T, o.id, { vehiculoPlanIds: [] });
    assert.equal(sinPlanes.origen, 'manual');
  });

  await test('anular; una anulada no se edita (409)', async () => {
    const { svc } = crearMock();
    const o = await svc.create(T, 'u1', base);
    const a = await svc.anular(T, o.id);
    assert.equal(a.estado, 'anulada');
    await assert.rejects(svc.update(T, o.id, { km: 1 }), ConflictException);
  });

  await test('borrar: con planes → 409; sin planes → borra', async () => {
    const { svc, db } = crearMock();
    const conPlan = await svc.create(T, 'u1', { ...base, vehiculoPlanIds: ['vp1'] });
    const sinPlan = await svc.create(T, 'u1', base);
    await assert.rejects(svc.remove(T, conPlan.id), ConflictException);
    await svc.remove(T, sinPlan.id);
    assert.deepEqual(db.ordenes.map((o) => o.id), [conPlan.id]);
  });

  await test('OT de otro tenant → 404 en get/update/anular/delete', async () => {
    const { svc, db } = crearMock();
    db.ordenes.push({ id: 'oB', tenantId: 'org_B', vehiculoId: 'vB', estado: 'cerrada' });
    await assert.rejects(svc.findOne(T, 'oB'), NotFoundException);
    await assert.rejects(svc.update(T, 'oB', { km: 1 }), NotFoundException);
    await assert.rejects(svc.anular(T, 'oB'), NotFoundException);
    await assert.rejects(svc.remove(T, 'oB'), NotFoundException);
    assert.equal(db.ordenes[0].estado, 'cerrada');
  });

  await test('subir adjunto: sin archivo o con tipo no permitido → 400', async () => {
    const { svc } = crearMock();
    await assert.rejects(svc.subirAdjunto(T, undefined), BadRequestException);
    await assert.rejects(
      svc.subirAdjunto(T, { mimetype: 'application/zip', originalname: 'x.zip', buffer: Buffer.from('') } as Express.Multer.File),
      BadRequestException,
    );
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
