/**
 * Pruebas del odómetro (MANT-01-T3): funciones puras + OdometroService con Prisma mockeado.
 * Ejecutar: npm run test:odometro
 */
import * as assert from 'node:assert/strict';
import { OdometroService } from './odometro.service';
import { calcularKmPorDia, compararLecturas, ordenarLecturas, ultimaLectura } from './odometro.util';
import type { LecturaKm } from './odometro.types';
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

const d = (iso: string) => new Date(iso);
const lec = (km: number, fecha: string, fuente: string, createdAt = fecha, fuenteId = `${fuente}-${km}`): LecturaKm => ({
  km,
  fecha: d(fecha),
  fuente,
  fuenteId,
  createdAt: d(createdAt),
});

// ── Mock de Prisma: filtra por where (tenantId, vehiculoId in, sospechoso, estado, km not null, fecha) ──
type Row = Record<string, any>;
function filtrar(rows: Row[], where: Row): Row[] {
  return rows.filter((r) => {
    if (r.tenantId !== where.tenantId) return false;
    if (where.vehiculoId?.in && !where.vehiculoId.in.includes(r.vehiculoId)) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.sospechoso !== undefined && r.sospechoso !== where.sospechoso) return false;
    if (where.estado !== undefined && r.estado !== where.estado) return false;
    if (where.km?.not === null && r.km === null) return false;
    if (where.fecha?.gte && r.fecha < where.fecha.gte) return false;
    if (where.fecha?.lte && r.fecha > where.fecha.lte) return false;
    return true;
  });
}
function findMany(rows: Row[], calls: Row[], modelo: string) {
  return async (args: Row) => {
    calls.push({ modelo, where: args.where });
    let res = filtrar(rows, args.where);
    if (args.distinct) {
      res = [...res].sort((a, b) => (b.fecha - a.fecha) || (b.createdAt - a.createdAt));
      const vistos = new Set<string>();
      res = res.filter((r) => (vistos.has(r.vehiculoId) ? false : (vistos.add(r.vehiculoId), true)));
    }
    return res;
  };
}
function crearPrisma(data: { cargas?: Row[]; ediciones?: Row[]; ordenes?: Row[]; vehiculos?: Row[] }) {
  const calls: Row[] = [];
  const prisma = {
    cargaCombustible: { findMany: findMany(data.cargas ?? [], calls, 'carga') },
    vehiculoKmEdicion: { findMany: findMany(data.ediciones ?? [], calls, 'edicion') },
    ordenTrabajo: { findMany: findMany(data.ordenes ?? [], calls, 'orden') },
    vehiculo: { findMany: findMany(data.vehiculos ?? [], calls, 'vehiculo') },
  };
  return { prisma: prisma as unknown as PrismaService, calls };
}

(async () => {
  // ── Funciones puras ──
  await test('distinto día: gana el día aunque la carga tenga hora', () => {
    const edicionAyer = lec(100, '2026-10-04T00:00:00Z', 'edicion', '2026-10-04T23:00:00Z');
    const cargaHoy = lec(90, '2026-10-05T08:00:00Z', 'carga', '2026-10-05T08:00:00Z');
    assert.ok(compararLecturas(cargaHoy, edicionAyer) > 0);
  });

  await test('mismo día, carga vs carga: ordena por hora real aunque se hayan cargado al revés', () => {
    const tarde = lec(200, '2026-10-05T20:00:00Z', 'carga', '2026-10-05T09:00:00Z');
    const manana = lec(150, '2026-10-05T08:00:00Z', 'carga', '2026-10-05T21:00:00Z');
    assert.deepEqual(ordenarLecturas([tarde, manana]).map((l) => l.km), [150, 200]);
  });

  await test('mismo día, edición de la tarde vs carga de la mañana: gana la edición (createdAt)', () => {
    const carga = lec(150, '2026-10-05T08:00:00Z', 'carga', '2026-10-05T08:05:00Z');
    const edicion = lec(155, '2026-10-05T00:00:00Z', 'edicion', '2026-10-05T18:00:00Z');
    assert.equal(ultimaLectura([edicion, carga])?.fuente, 'edicion');
  });

  await test('ultimaLectura de una lista vacía → null', () => {
    assert.equal(ultimaLectura([]), null);
  });

  const hoy = d('2026-10-05T12:00:00Z');
  await test('km/día caso feliz: 3.000 km en 30 días → 100', () => {
    const r = calcularKmPorDia(
      [lec(10_000, '2026-09-05T12:00:00Z', 'carga'), lec(11_500, '2026-09-20T12:00:00Z', 'edicion'), lec(13_000, '2026-10-05T12:00:00Z', 'orden_trabajo')],
      hoy,
    );
    assert.equal(r, 100);
  });

  await test('km/día con menos de 3 lecturas → null', () => {
    assert.equal(calcularKmPorDia([lec(1, '2026-09-01T00:00:00Z', 'carga'), lec(5_000, '2026-10-01T00:00:00Z', 'carga')], hoy), null);
  });

  await test('km/día con rango menor a 14 días → null', () => {
    const r = calcularKmPorDia(
      [lec(1_000, '2026-09-25T00:00:00Z', 'carga'), lec(2_000, '2026-09-30T00:00:00Z', 'carga'), lec(3_000, '2026-10-05T00:00:00Z', 'carga')],
      hoy,
    );
    assert.equal(r, null);
  });

  await test('km/día ≤ 0 (km sin cambios) → null', () => {
    const r = calcularKmPorDia(
      [lec(5_000, '2026-09-01T00:00:00Z', 'carga'), lec(5_000, '2026-09-15T00:00:00Z', 'carga'), lec(5_000, '2026-10-01T00:00:00Z', 'carga')],
      hoy,
    );
    assert.equal(r, null);
  });

  await test('km/día ignora lecturas de más de 60 días y la fuente vehiculo', () => {
    const r = calcularKmPorDia(
      [
        lec(0, '2026-05-01T00:00:00Z', 'carga'), // fuera de ventana
        lec(99_999, '2026-09-10T00:00:00Z', 'vehiculo'), // fallback, no cuenta
        lec(10_000, '2026-09-05T12:00:00Z', 'carga'),
        lec(11_000, '2026-09-20T12:00:00Z', 'carga'),
        lec(13_000, '2026-10-05T12:00:00Z', 'carga'),
      ],
      hoy,
    );
    assert.equal(r, 100);
  });

  // ── Service ──
  const T = 'org_A';
  const base = () => ({
    cargas: [
      { id: 'c1', tenantId: T, vehiculoId: 'v1', km: 10_000, fecha: d('2026-09-05T10:00:00Z'), createdAt: d('2026-09-05T10:00:00Z'), sospechoso: false },
      { id: 'c2', tenantId: T, vehiculoId: 'v1', km: 99_999, fecha: d('2026-10-04T10:00:00Z'), createdAt: d('2026-10-04T10:00:00Z'), sospechoso: true },
      { id: 'c3', tenantId: T, vehiculoId: 'v1', km: 12_000, fecha: d('2026-09-25T10:00:00Z'), createdAt: d('2026-09-25T10:00:00Z'), sospechoso: false },
      { id: 'cX', tenantId: 'org_B', vehiculoId: 'v1', km: 1, fecha: d('2026-10-05T10:00:00Z'), createdAt: d('2026-10-05T10:00:00Z'), sospechoso: false },
    ],
    ediciones: [
      { id: 'e1', tenantId: T, vehiculoId: 'v1', kmNuevo: 12_500, fecha: d('2026-09-30T00:00:00Z'), createdAt: d('2026-09-30T15:00:00Z') },
      { id: 'e2', tenantId: T, vehiculoId: 'v2', kmNuevo: 7_000, fecha: d('2026-09-01T00:00:00Z'), createdAt: d('2026-09-01T15:00:00Z') },
    ],
    ordenes: [
      { id: 'o1', tenantId: T, vehiculoId: 'v1', km: 13_000, estado: 'cerrada', fecha: d('2026-10-02T00:00:00Z'), createdAt: d('2026-10-02T12:00:00Z') },
      { id: 'o2', tenantId: T, vehiculoId: 'v1', km: 50_000, estado: 'anulada', fecha: d('2026-10-03T00:00:00Z'), createdAt: d('2026-10-03T12:00:00Z') },
      { id: 'o3', tenantId: T, vehiculoId: 'v1', km: null, estado: 'cerrada', fecha: d('2026-10-04T00:00:00Z'), createdAt: d('2026-10-04T12:00:00Z') },
    ],
    vehiculos: [
      { id: 'v1', tenantId: T, kmActual: 99_999, createdAt: d('2026-01-01T00:00:00Z') },
      { id: 'v2', tenantId: T, kmActual: 7_000, createdAt: d('2026-01-01T00:00:00Z') },
      { id: 'v3', tenantId: T, kmActual: 3_000, createdAt: d('2026-02-01T00:00:00Z') },
      { id: 'vB', tenantId: 'org_B', kmActual: 1, createdAt: d('2026-02-01T00:00:00Z') },
    ],
  });

  await test('getLecturas: une las 3 fuentes, filtra sospechosas, anuladas, sin km y otro tenant', async () => {
    const { prisma, calls } = crearPrisma(base());
    const ls = await new OdometroService(prisma).getLecturas(T, 'v1');
    assert.deepEqual(ls.map((l) => `${l.fuente}:${l.fuenteId}:${l.km}`), [
      'carga:c1:10000', 'carga:c3:12000', 'edicion:e1:12500', 'orden_trabajo:o1:13000',
    ]);
    assert.ok(calls.every((c) => c.where.tenantId === T), 'toda query lleva tenantId');
    assert.equal(calls.find((c) => c.modelo === 'carga')?.where.sospechoso, false);
    assert.equal(calls.find((c) => c.modelo === 'orden')?.where.estado, 'cerrada');
  });

  await test('getLecturas respeta desde/hasta', async () => {
    const { prisma } = crearPrisma(base());
    const ls = await new OdometroService(prisma).getLecturas(T, 'v1', { desde: d('2026-09-20T00:00:00Z'), hasta: d('2026-09-30T23:59:59Z') });
    assert.deepEqual(ls.map((l) => l.fuenteId), ['c3', 'e1']);
  });

  await test('getUltimaLectura: la OT cerrada más nueva gana', async () => {
    const { prisma } = crearPrisma(base());
    const u = await new OdometroService(prisma).getUltimaLectura(T, 'v1');
    assert.equal(u?.fuente, 'orden_trabajo');
    assert.equal(u?.km, 13_000);
  });

  await test('getUltimaLectura sin lecturas → fallback a kmActual (fuente vehiculo)', async () => {
    const { prisma } = crearPrisma(base());
    const u = await new OdometroService(prisma).getUltimaLectura(T, 'v3');
    assert.deepEqual([u?.fuente, u?.km, u?.fuenteId], ['vehiculo', 3_000, 'v3']);
  });

  await test('getUltimaLectura de un vehículo de otro tenant → null', async () => {
    const { prisma } = crearPrisma(base());
    assert.equal(await new OdometroService(prisma).getUltimaLectura(T, 'vB'), null);
  });

  await test('getUltimasLecturas por lote: 4 queries para 3 vehículos, fuentes mezcladas', async () => {
    const { prisma, calls } = crearPrisma(base());
    const m = await new OdometroService(prisma).getUltimasLecturas(T, ['v1', 'v2', 'v3', 'v1']);
    assert.equal(m.get('v1')?.fuenteId, 'o1');
    assert.equal(m.get('v2')?.fuenteId, 'e2');
    assert.equal(m.get('v3')?.fuente, 'vehiculo');
    assert.equal(calls.length, 4);
  });

  await test('getKmPorDia: (13.000 − 10.000) / días entre 05/09 10:00 y 02/10 00:00', async () => {
    const { prisma } = crearPrisma(base());
    const r = await new OdometroService(prisma).getKmPorDia(T, 'v1', d('2026-10-05T12:00:00Z'));
    const dias = (d('2026-10-02T00:00:00Z').getTime() - d('2026-09-05T10:00:00Z').getTime()) / 86_400_000;
    assert.ok(r !== null && Math.abs(r - 3_000 / dias) < 1e-9);
  });

  await test('getKmPorDia con una sola lectura → null', async () => {
    const { prisma } = crearPrisma(base());
    assert.equal(await new OdometroService(prisma).getKmPorDia(T, 'v2', d('2026-10-05T12:00:00Z')), null);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
