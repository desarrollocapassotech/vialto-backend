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

test('computeLiquidacionTotales respeta el ivaPct de cada concepto (0% no baja el IVA gravado)', () => {
  const montos = computeLiquidacionTotales({
    bruto: 1000,
    comision: 0,
    ivaPctDefault: 10,
    lineas: [
      {
        nombreSnapshot: 'Plus',
        signo: 'favor',
        ivaPct: 21,
        monto: 200,
      },
    ],
  });
  // 1000 × 10% + 200 × 21% = 100 + 42 (no se pisa el catálogo con el IVA general)
  assert.equal(montos.impNeto, 1200);
  assert.equal(montos.impIva, 142);
  assert.equal(montos.liquido, 1342);
});

test('computeLiquidacionTotales: gastos/seguro a 0% no reducen el IVA de flete+comisión', () => {
  const montos = computeLiquidacionTotales({
    bruto: 1_102_200,
    comision: 88_176,
    ivaPctDefault: 21,
    lineas: [
      { nombreSnapshot: 'Gastos administrativos', signo: 'contra', ivaPct: 0, monto: 1_500 },
      { nombreSnapshot: 'Seguro de carga', signo: 'contra', ivaPct: 0, monto: 3_500 },
    ],
  });
  // Neto pie = todas las líneas; IVA = 21% de (flete − comisión) solamente
  assert.equal(montos.impNeto, 1_009_024);
  assert.equal(montos.impIva, 212_945.04);
  assert.equal(montos.liquido, 1_221_969.04);
});

console.log('cvlp-conceptos.util.spec.ts OK');
