/**
 * Pruebas de totales de liquidación con IVA configurable.
 * Ejecutar: npx ts-node src/modules/liquidaciones-arca/cvlp-conceptos.util.spec.ts
 */
import * as assert from 'node:assert/strict';
import { computeLiquidacionTotales } from './cvlp-conceptos.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('computeLiquidacionTotales aplica el ivaPct del usuario (ej. 10%), no 21%', () => {
  const montos = computeLiquidacionTotales({
    bruto: 1000,
    comision: 395,
    ivaPctDefault: 10,
  });
  // Neto gravado 605 → IVA 10% = 60.50 (antes se remapaba a 21% = 127.05)
  assert.equal(montos.impNeto, 605);
  assert.equal(montos.impIva, 60.5);
  assert.equal(montos.liquido, 665.5);
});

test('computeLiquidacionTotales respeta ivaPct 0 (sin IVA)', () => {
  const montos = computeLiquidacionTotales({
    bruto: 1000,
    comision: 100,
    ivaPctDefault: 0,
  });
  assert.equal(montos.impNeto, 900);
  assert.equal(montos.impIva, 0);
  assert.equal(montos.liquido, 900);
});

test('computeLiquidacionTotales aplica el IVA de la liquidación también a conceptos', () => {
  const montos = computeLiquidacionTotales({
    bruto: 1000,
    comision: 0,
    ivaPctDefault: 10,
    lineas: [
      {
        nombreSnapshot: 'Plus',
        signo: 'favor',
        ivaPct: 21, // catálogo; se ignora a favor del IVA de la liquidación
        monto: 200,
      },
    ],
  });
  // Neto 1200 × 10% = 120 (no usa el 21% del concepto)
  assert.equal(montos.impNeto, 1200);
  assert.equal(montos.impIva, 120);
  assert.equal(montos.liquido, 1320);
});

console.log('cvlp-conceptos.util.spec.ts OK');
