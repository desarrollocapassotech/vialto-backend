/**
 * Pruebas del cálculo de vencimientos de mantenimiento (MANT-01-T4).
 * Ejecutar: npm run test:vencimiento
 */
import * as assert from 'node:assert/strict';
import {
  calcularVencimiento,
  elegirReferencia,
  type CalcularVencimientoInput,
  type PlanIntervalos,
} from './vencimiento.util';

let fallos = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const HOY = d('2026-10-05');

const soloKm: PlanIntervalos = { intervaloKm: 20_000, intervaloDias: null, avisoKm: 2_000, avisoDias: null };
const soloDias: PlanIntervalos = { intervaloKm: null, intervaloDias: 365, avisoKm: null, avisoDias: 30 };
const kmYDias: PlanIntervalos = { intervaloKm: 20_000, intervaloDias: 180, avisoKm: 2_000, avisoDias: 15 };

function calc(p: Partial<CalcularVencimientoInput> & { plan: PlanIntervalos }) {
  return calcularVencimiento({ referencia: null, odometro: null, kmPorDia: null, hoy: HOY, ...p });
}
const odo = (km: number) => ({ km, fecha: HOY });

// ── Solo km ──
test('solo km: ok', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(110_000) });
  assert.equal(r.estado, 'ok');
  assert.equal(r.proximoKm, 120_000);
  assert.equal(r.kmRestantes, 10_000);
  assert.equal(r.motivo, null);
});

test('solo km: próximo (dentro del aviso)', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(118_500) });
  assert.deepEqual([r.estado, r.motivo, r.kmRestantes], ['proximo', 'km', 1_500]);
});

test('solo km: vencido con km restantes = 0', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(120_000) });
  assert.deepEqual([r.estado, r.motivo], ['vencido', 'km']);
});

test('solo km: vencido pasado del intervalo', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(125_000) });
  assert.deepEqual([r.estado, r.kmRestantes], ['vencido', -5_000]);
});

// ── Solo días ──
test('solo días: ok', () => {
  const r = calc({ plan: soloDias, referencia: { km: null, fecha: d('2026-03-01') } });
  assert.equal(r.estado, 'ok');
  assert.equal(iso(r.proximaFecha), '2027-03-01');
  assert.equal(r.diasRestantes, 147);
});

test('solo días: próximo', () => {
  const r = calc({ plan: soloDias, referencia: { km: null, fecha: d('2025-10-20') } });
  assert.deepEqual([r.estado, r.motivo, r.diasRestantes], ['proximo', 'fecha', 15]);
});

test('solo días: vencido el mismo día de la próxima fecha', () => {
  const r = calc({ plan: soloDias, referencia: { km: null, fecha: d('2025-10-05') } });
  assert.deepEqual([r.estado, r.motivo, r.diasRestantes], ['vencido', 'fecha', 0]);
});

test('hoy con hora (23:59 UTC) se normaliza al día', () => {
  const r = calc({ plan: soloDias, referencia: { km: null, fecha: d('2025-10-06') }, hoy: new Date('2026-10-05T23:59:00Z') });
  assert.deepEqual([r.estado, r.diasRestantes], ['proximo', 1]);
});

// ── Km y días ──
test('km y días: gana el más grave (km vencido, fecha ok)', () => {
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-09-01') }, odometro: odo(121_000) });
  assert.deepEqual([r.estado, r.motivo], ['vencido', 'km']);
});

test('km y días: gana el más grave (fecha vencida, km ok)', () => {
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-03-01') }, odometro: odo(105_000) });
  assert.deepEqual([r.estado, r.motivo], ['vencido', 'fecha']);
});

test('km y días, mismo estado: con proyección gana el que ocurre primero (fecha)', () => {
  // próxima fecha 2026-10-15 (10 días); km restantes 1.500 a 100 km/día → 15 días
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-04-18') }, odometro: odo(118_500), kmPorDia: 100 });
  assert.equal(iso(r.proximaFecha), '2026-10-15');
  assert.deepEqual([r.estado, r.motivo], ['proximo', 'fecha']);
  assert.equal(iso(r.fechaEstimada), '2026-10-15');
});

test('km y días, mismo estado: con proyección gana el que ocurre primero (km)', () => {
  // km restantes 500 a 100 km/día → 5 días; próxima fecha en 10 días
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-04-18') }, odometro: odo(119_500), kmPorDia: 100 });
  assert.deepEqual([r.estado, r.motivo], ['proximo', 'km']);
  assert.equal(iso(r.fechaEstimada), '2026-10-10');
});

test('km y días, mismo estado, sin proyección → gana km', () => {
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-04-18') }, odometro: odo(118_500) });
  assert.deepEqual([r.estado, r.motivo], ['proximo', 'km']);
});

// ── Sin datos ──
test('sin referencia → sin_datos', () => {
  const r = calc({ plan: kmYDias, referencia: null, odometro: odo(100_000) });
  assert.deepEqual([r.estado, r.motivo, r.fechaEstimada], ['sin_datos', null, null]);
});

test('plan por km sin odómetro → sin_datos (pero devuelve proximoKm)', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: d('2026-01-01') } });
  assert.deepEqual([r.estado, r.proximoKm, r.kmRestantes], ['sin_datos', 120_000, null]);
});

test('plan por km sin km de referencia → sin_datos', () => {
  const r = calc({ plan: soloKm, referencia: { km: null, fecha: d('2026-01-01') }, odometro: odo(100_000) });
  assert.equal(r.estado, 'sin_datos');
});

test('plan km + días sin odómetro pero con fecha → se evalúa por fecha', () => {
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-03-01') } });
  assert.deepEqual([r.estado, r.motivo, r.kmRestantes], ['vencido', 'fecha', null]);
});

// ── Proyección ──
test('proyección sin kmPorDia → fechaEstimada = proximaFecha', () => {
  const r = calc({ plan: kmYDias, referencia: { km: 100_000, fecha: d('2026-09-01') }, odometro: odo(105_000) });
  assert.equal(iso(r.fechaEstimada), '2027-02-28');
});

test('proyección sin kmPorDia ni días → fechaEstimada null', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(105_000) });
  assert.equal(r.fechaEstimada, null);
});

test('proyección con km ya vencido queda en el pasado', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(120_500), kmPorDia: 100 });
  assert.equal(iso(r.fechaEstimada), '2026-09-30'); // −500 km a 100 km/día = 5 días atrás
});

// ── Bordes ──
test('odómetro menor que la referencia → ok sin explotar', () => {
  const r = calc({ plan: soloKm, referencia: { km: 100_000, fecha: null }, odometro: odo(90_000), kmPorDia: 100 });
  assert.equal(r.estado, 'ok');
  assert.ok((r.kmRestantes as number) > 20_000);
});

test('sin avisoKm/avisoDias nunca da próximo', () => {
  const plan: PlanIntervalos = { intervaloKm: 40_000, intervaloDias: 30, avisoKm: null, avisoDias: null };
  const r = calc({ plan, referencia: { km: 100_000, fecha: d('2026-09-06') }, odometro: odo(139_999) });
  assert.deepEqual([r.estado, r.kmRestantes, r.diasRestantes], ['ok', 1, 1]);
});

// ── elegirReferencia ──
test('con base y sin OT → usa la base', () => {
  const r = elegirReferencia({ base: { km: 80_000, fecha: d('2026-01-10') }, ultimaOrden: null, kmOdometroALaFechaDeLaOrden: null });
  assert.deepEqual(r, { id: 'base', km: 80_000, fecha: d('2026-01-10') });
});

test('OT más nueva que la base → usa la OT', () => {
  const r = elegirReferencia({
    base: { km: 80_000, fecha: d('2026-01-10') },
    ultimaOrden: { id: 'ot1', km: 100_000, fecha: d('2026-06-01') },
    kmOdometroALaFechaDeLaOrden: 99_000,
  });
  assert.deepEqual(r, { id: 'ot1', km: 100_000, fecha: d('2026-06-01') });
});

test('OT sin km → toma el km del odómetro a esa fecha', () => {
  const r = elegirReferencia({ base: { km: 80_000, fecha: null }, ultimaOrden: { id: 'ot2', km: null, fecha: d('2026-06-01') }, kmOdometroALaFechaDeLaOrden: 99_000 });
  assert.equal(r?.km, 99_000);
});

test('OT sin km y sin odómetro → km null (la parte por km queda sin datos)', () => {
  const ref = elegirReferencia({ base: { km: 80_000, fecha: null }, ultimaOrden: { id: 'ot3', km: null, fecha: d('2026-06-01') }, kmOdometroALaFechaDeLaOrden: null });
  assert.equal(ref?.km, null);
  const r = calc({ plan: kmYDias, referencia: ref, odometro: odo(120_000) });
  assert.deepEqual([r.estado, r.motivo], ['ok', null]); // se evalúa solo por fecha (vence 2026-11-28)
});

test('sin base ni OT → null', () => {
  assert.equal(elegirReferencia({ base: { km: null, fecha: null }, ultimaOrden: null, kmOdometroALaFechaDeLaOrden: null }), null);
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
