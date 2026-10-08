/**
 * Pruebas del semáforo de vencimientos (MANT-02-T5): armado de filas + VencimientosService mockeado.
 * Ejecutar: npm run test:mant-vencimientos
 */
import * as assert from 'node:assert/strict';
import { VencimientosService } from './vencimientos.service';
import {
  armarFilaVencimiento,
  elegirUltimaOrden,
  kmHastaElDia,
  ordenarVencimientos,
  resumirVencimientos,
  type AsignacionVencimiento,
  type FilaVencimiento,
} from './vencimientos.util';
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
const HOY = d('2026-10-05');
const lec = (km: number, fecha: string, fuente = 'carga'): LecturaKm => ({ km, fecha: d(fecha), fuente, fuenteId: `${fuente}-${km}`, createdAt: d(fecha) });

const service20k = { id: 'p1', nombre: 'Service', categoria: 'mecanico', intervaloKm: 20_000, intervaloDias: null, avisoKm: 2_000, avisoDias: null };
const vtv = { id: 'p2', nombre: 'VTV', categoria: 'documental', intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 30 };
const asig = (o: Partial<AsignacionVencimiento> = {}): AsignacionVencimiento => ({
  vehiculoPlanId: 'vp1', vehiculo: { id: 'v1', patente: 'AAA', tipo: 'tractor' }, plan: service20k, baseKm: null, baseFecha: null, ...o,
});

(async () => {
  // ── Puros ──
  await test('con base y sin OT → referencia base', () => {
    const f = armarFilaVencimiento({
      asignacion: asig({ baseKm: 100_000 }), ultimaOrden: null, kmOdometroALaFechaDeLaOrden: null,
      odometro: lec(119_000, '2026-10-01'), kmPorDia: null, hoy: HOY,
    });
    assert.deepEqual([f.referencia?.tipo, f.referencia?.id, f.estado, f.kmRestantes, f.odometro?.fuente], ['base', 'base', 'proximo', 1_000, 'carga']);
  });

  await test('OT más nueva que la base → referencia OT con su número', () => {
    const f = armarFilaVencimiento({
      asignacion: asig({ baseKm: 100_000 }),
      ultimaOrden: { id: 'o7', numero: 7, km: 118_000, fecha: d('2026-09-01'), createdAt: d('2026-09-01') },
      kmOdometroALaFechaDeLaOrden: null, odometro: lec(119_000, '2026-10-01'), kmPorDia: null, hoy: HOY,
    });
    assert.deepEqual([f.referencia?.tipo, f.referencia?.ordenNumero, f.estado, f.kmRestantes], ['orden', 7, 'ok', 19_000]);
  });

  await test('OT sin km → usa el km del odómetro a esa fecha', () => {
    const lecturas = [lec(110_000, '2026-08-01'), lec(115_000, '2026-09-01T18:00:00Z'), lec(118_000, '2026-09-20')];
    const km = kmHastaElDia(lecturas, d('2026-09-01'));
    assert.equal(km, 115_000); // incluye la lectura de ese mismo día
    const f = armarFilaVencimiento({
      asignacion: asig(), ultimaOrden: { id: 'o8', numero: 8, km: null, fecha: d('2026-09-01'), createdAt: d('2026-09-01') },
      kmOdometroALaFechaDeLaOrden: km, odometro: lec(118_000, '2026-09-20'), kmPorDia: null, hoy: HOY,
    });
    assert.deepEqual([f.referencia?.km, f.kmRestantes, f.estado], [115_000, 17_000, 'ok']);
  });

  await test('sin base ni OT → sin_datos', () => {
    const f = armarFilaVencimiento({ asignacion: asig(), ultimaOrden: null, kmOdometroALaFechaDeLaOrden: null, odometro: lec(1, '2026-10-01'), kmPorDia: null, hoy: HOY });
    assert.deepEqual([f.estado, f.referencia], ['sin_datos', null]);
  });

  await test('elegirUltimaOrden: por fecha y, si empatan, por createdAt', () => {
    const o = elegirUltimaOrden([
      { id: 'a', numero: 1, km: 1, fecha: d('2026-09-01'), createdAt: d('2026-09-01T10:00:00Z') },
      { id: 'b', numero: 2, km: 2, fecha: d('2026-09-01'), createdAt: d('2026-09-01T12:00:00Z') },
      { id: 'c', numero: 3, km: 3, fecha: d('2026-08-01'), createdAt: d('2026-10-01') },
    ]);
    assert.equal(o?.id, 'b');
    assert.equal(elegirUltimaOrden([]), null);
  });

  await test('orden: vencido → próximo → sin datos → ok; fecha estimada y patente desempatan', () => {
    const fila = (estado: FilaVencimiento['estado'], patente: string, fecha: string | null) =>
      ({ estado, vehiculo: { patente }, plan: { nombre: 'X' }, fechaEstimada: fecha ? d(fecha) : null }) as unknown as FilaVencimiento;
    const r = ordenarVencimientos([
      fila('ok', 'A', null), fila('proximo', 'B', '2026-10-20'), fila('vencido', 'Z', null),
      fila('proximo', 'C', '2026-10-10'), fila('sin_datos', 'D', null), fila('vencido', 'Y', '2026-09-01'),
    ]);
    assert.deepEqual(r.map((f) => `${f.estado}:${f.vehiculo.patente}`), [
      'vencido:Y', 'vencido:Z', 'proximo:C', 'proximo:B', 'sin_datos:D', 'ok:A',
    ]);
    assert.deepEqual(resumirVencimientos(r), { vencido: 2, proximo: 2, sin_datos: 1, ok: 1, total: 6 });
  });

  // ── Service ──
  type Row = Record<string, any>;
  const T = 'org_A';
  function crearMock() {
    const asignaciones: Row[] = [
      { id: 'vp1', tenantId: T, activo: true, baseKm: 100_000, baseFecha: null, vehiculo: { id: 'v1', patente: 'AAA', tipo: 'tractor', activo: true }, plan: { ...service20k, activo: true } },
      { id: 'vp2', tenantId: T, activo: true, baseKm: null, baseFecha: d('2025-10-20'), vehiculo: { id: 'v1', patente: 'AAA', tipo: 'tractor', activo: true }, plan: { ...vtv, activo: true } },
      { id: 'vp3', tenantId: T, activo: true, baseKm: 100_000, baseFecha: null, vehiculo: { id: 'v2', patente: 'BBB', tipo: 'tractor', activo: true }, plan: { ...service20k, activo: true } },
      { id: 'vpX', tenantId: T, activo: false, baseKm: 1, baseFecha: null, vehiculo: { id: 'v1', patente: 'AAA', tipo: 'tractor', activo: true }, plan: { ...service20k, activo: true } },
      { id: 'vpY', tenantId: T, activo: true, baseKm: 1, baseFecha: null, vehiculo: { id: 'v3', patente: 'CCC', tipo: 'tractor', activo: false }, plan: { ...service20k, activo: true } },
      { id: 'vpZ', tenantId: T, activo: true, baseKm: 1, baseFecha: null, vehiculo: { id: 'v1', patente: 'AAA', tipo: 'tractor', activo: true }, plan: { ...service20k, id: 'p9', activo: false } },
      { id: 'vpB', tenantId: 'org_B', activo: true, baseKm: 1, baseFecha: null, vehiculo: { id: 'vB', patente: 'ZZZ', tipo: 'tractor', activo: true }, plan: { ...service20k, activo: true } },
    ];
    const otPlanes: Row[] = [
      { tenantId: T, vehiculoPlanId: 'vp3', orden: { id: 'o1', numero: 1, km: 110_000, fecha: d('2026-06-01'), createdAt: d('2026-06-01'), estado: 'cerrada', tenantId: T } },
      { tenantId: T, vehiculoPlanId: 'vp3', orden: { id: 'o2', numero: 2, km: 121_000, fecha: d('2026-09-01'), createdAt: d('2026-09-01'), estado: 'anulada', tenantId: T } },
    ];
    const llamadas: Row[] = [];
    const prisma = {
      vehiculoPlan: {
        findMany: async ({ where }: Row) => {
          llamadas.push({ modelo: 'vehiculoPlan', where });
          return asignaciones.filter((a) =>
            a.tenantId === where.tenantId && a.activo === where.activo &&
            a.plan.activo === where.plan.activo && a.vehiculo.activo === where.vehiculo.activo &&
            (!where.vehiculoId || a.vehiculo.id === where.vehiculoId) &&
            (!where.plan.categoria || a.plan.categoria === where.plan.categoria));
        },
      },
      ordenTrabajoPlan: {
        findMany: async ({ where }: Row) => {
          llamadas.push({ modelo: 'ordenTrabajoPlan', where });
          return otPlanes.filter((p) => p.tenantId === where.tenantId && where.vehiculoPlanId.in.includes(p.vehiculoPlanId) && p.orden.estado === where.orden.estado);
        },
      },
    };
    const odometro = {
      getUltimasLecturas: async (tenantId: string) => {
        llamadas.push({ modelo: 'odometro', tenantId });
        return new Map([['v1', lec(119_000, '2026-10-01')], ['v2', lec(131_000, '2026-10-01')]]);
      },
      getKmPorDiaMuchos: async (tenantId: string) => {
        llamadas.push({ modelo: 'odometro', tenantId });
        return new Map([['v1', 100], ['v2', null]]);
      },
      getLecturasMuchos: async () => new Map(),
    } as unknown as OdometroService;
    return { svc: new VencimientosService(prisma as unknown as PrismaService, odometro), llamadas };
  }

  await test('service: excluye inactivos y otro tenant; ordena; la OT anulada no cuenta', async () => {
    const { svc, llamadas } = crearMock();
    const filas = await svc.calcular(T, {}, HOY);
    assert.deepEqual(filas.map((f) => `${f.vehiculoPlanId}:${f.estado}`), ['vp3:vencido', 'vp1:proximo', 'vp2:proximo']);
    const vp3 = filas[0];
    assert.deepEqual([vp3.referencia?.ordenNumero, vp3.kmRestantes], [1, -1_000]); // OT1 (110.000), no la anulada
    assert.ok(llamadas.filter((l) => l.where).every((l) => l.where.tenantId === T));
    assert.ok(llamadas.filter((l) => l.modelo === 'odometro').every((l) => l.tenantId === T));
  });

  await test('service: filtros estado, categoría y unidad', async () => {
    const { svc } = crearMock();
    assert.deepEqual((await svc.calcular(T, { estado: 'proximo' }, HOY)).map((f) => f.vehiculoPlanId), ['vp1', 'vp2']);
    assert.deepEqual((await svc.calcular(T, { categoria: 'documental' }, HOY)).map((f) => f.vehiculoPlanId), ['vp2']);
    assert.deepEqual((await svc.calcular(T, { vehiculoId: 'v2' }, HOY)).map((f) => f.vehiculoPlanId), ['vp3']);
  });

  await test('service: resumen y cantidad fija de llamadas', async () => {
    const { svc, llamadas } = crearMock();
    assert.deepEqual(await svc.resumen(T, HOY), { vencido: 1, proximo: 2, sin_datos: 0, ok: 0, total: 3 });
    assert.equal(llamadas.length, 4); // asignaciones + OT + última lectura + km/día
  });

  await test('service: tenant sin asignaciones → lista vacía sin consultar el odómetro', async () => {
    const { svc, llamadas } = crearMock();
    assert.deepEqual(await svc.calcular('org_vacio', {}, HOY), []);
    assert.equal(llamadas.length, 1);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
