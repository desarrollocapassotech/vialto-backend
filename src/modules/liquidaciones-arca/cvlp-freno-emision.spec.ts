/**
 * Freno de emisión de la liquidación (auditoría IVA, nov 2026, H1): el comprobante que
 * va a ARCA tiene que coincidir con la liquidación, salvo centavos de redondeo.
 * Casos y números del informe "Auditoría de cálculos de IVA" del 27/11/2026.
 * Ejecutar: npm run test:cvlp-freno
 */
import * as assert from 'node:assert/strict';
import { buildComprobanteCvlp } from './arca-cvlp.util';
import {
  buildCvlpConceptosList,
  compararTotalesCvlp,
  computeLiquidacionTotales,
  redondeosLiquidacion,
  type ConceptoLineaInput,
  type ViajeLiquidacionPayload,
} from './cvlp-conceptos.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mismo armado que `emitirLiquidacion`. */
function comparar(args: {
  ivaPctDefault: number;
  viajes: ViajeLiquidacionPayload[];
  lineas?: ConceptoLineaInput[];
}) {
  const bruto = round2(args.viajes.reduce((s, v) => s + (v.bruto ?? 0), 0));
  const comision = round2(args.viajes.reduce((s, v) => s + (v.comision ?? 0), 0));
  const full = { bruto, comision, ...args };
  const sistema = computeLiquidacionTotales(full);
  const arca = buildComprobanteCvlp(
    {} as Parameters<typeof buildComprobanteCvlp>[0],
    buildCvlpConceptosList(full),
    args.ivaPctDefault,
  );
  return { sistema, arca, r: compararTotalesCvlp(sistema, arca, redondeosLiquidacion(full)) };
}

const viaje = (ivaPct?: number, extra: Partial<ViajeLiquidacionPayload> = {}) => ({
  id: '1',
  numero: 1,
  bruto: 1000,
  comision: 80,
  ivaPct,
  ...extra,
});

test('A: viaje y comisión al 21% coinciden (no se frena)', () => {
  const { sistema, r } = comparar({ ivaPctDefault: 21, viajes: [viaje(21)] });
  assert.equal(sistema.liquido, 1113.2);
  assert.equal(r.coincide, true);
});

test('G: IVA sobre comisión en 0 con viaje al 21% se frena (la comisión no se descontaba)', () => {
  const { sistema, arca, r } = comparar({ ivaPctDefault: 0, viajes: [viaje(21)] });
  assert.equal(sistema.liquido, 1130);
  assert.equal(arca.impTotal, 1210);
  assert.equal(r.coincide, false);
});

test('I: descuento de 100 al 0% se frena (el descuento desaparecía del envío)', () => {
  const { arca, r } = comparar({
    ivaPctDefault: 21,
    viajes: [viaje(21)],
    lineas: [{ nombreSnapshot: 'Descuento', signo: 'contra', ivaPct: 0, monto: 100 }],
  });
  assert.equal(arca.impTotal, 1113.2);
  assert.equal(r.coincide, false);
});

test('B: viaje al 10,5% con comisión al 21% se frena', () => {
  const { r } = comparar({ ivaPctDefault: 21, viajes: [viaje(10.5)] });
  assert.equal(r.difTotal, 8.4);
  assert.equal(r.coincide, false);
});

test('Viaje y comisión al 10,5% coinciden', () => {
  assert.equal(comparar({ ivaPctDefault: 10.5, viajes: [viaje(10.5)] }).r.coincide, true);
});

test('D: tramo al 21% y resto al 0% coinciden', () => {
  const { r } = comparar({
    ivaPctDefault: 21,
    viajes: [viaje(undefined, { tramosIva: [{ base: 200, ivaPct: 21 }, { base: 800, ivaPct: 0 }] })],
  });
  assert.equal(r.coincide, true);
});

test('L: concepto a favor al 0% coincide', () => {
  const { r } = comparar({
    ivaPctDefault: 21,
    viajes: [viaje(21)],
    lineas: [{ nombreSnapshot: 'Reintegro', signo: 'favor', ivaPct: 0, monto: 100 }],
  });
  assert.equal(r.coincide, true);
});

test('Redondeo: 5.000 liquidaciones al 21% con varios viajes nunca se frenan', () => {
  // Semilla fija: mismo resultado en cada corrida.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let conCentavos = 0;
  for (let i = 0; i < 5000; i++) {
    const pct = i % 2 ? 7 : 8;
    const viajes = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, j) => {
      const b = round2(rnd() * 5_000_000);
      return { id: String(j), numero: j, bruto: b, comision: round2((b * pct) / 100), ivaPct: 21 };
    });
    const { r } = comparar({ ivaPctDefault: 21, viajes });
    if (r.difTotal !== 0) conCentavos++;
    assert.equal(r.coincide, true, `caso ${i}: ${JSON.stringify(r)}`);
  }
  // Confirma que la prueba ejercita el redondeo (hay diferencias de centavos reales).
  assert.ok(conCentavos > 0);
});
