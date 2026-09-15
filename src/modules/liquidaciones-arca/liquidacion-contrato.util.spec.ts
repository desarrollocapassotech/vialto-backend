/**
 * Agrupación de flete para el PDF contrato proveedor.
 * Ejecutar: npx ts-node --transpile-only src/modules/liquidaciones-arca/liquidacion-contrato.util.spec.ts
 */
import * as assert from 'node:assert/strict';
import { buildLiquidacionContratoTotales } from './liquidacion-contrato.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const base = {
  numero: '1',
  origen: 'A',
  destino: 'B',
  fechaCarga: '2026-01-10',
  fechaDescarga: '2026-01-12',
  choferNombre: 'Juan',
  mercaderia: 'Soja',
  crt: 'CRT-1',
  mic: 'MIC-1',
  remito: null,
  adelanto: 0,
  moneda: 'USD',
};

test('un viaje: un solo grupo y IVA sobre el subtotal', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      {
        ...base,
        toneladas: 30,
        precioPorTn: 50,
        subtotal: 1500,
        adelanto: 200,
      },
    ],
  });
  assert.equal(t.cantViajes, 1);
  assert.equal(t.mismoPrecio, true);
  assert.equal(t.grupos.length, 1);
  assert.equal(t.subtotal, 1500);
  assert.equal(t.iva, 315);
  assert.equal(t.adelanto, 200);
  assert.equal(t.totalFlete, 1615);
});

test('varios viajes con el mismo precio x TN: una sola vista', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      { ...base, numero: '1', toneladas: 10, precioPorTn: 40, subtotal: 400, adelanto: 50 },
      { ...base, numero: '2', toneladas: 15, precioPorTn: 40, subtotal: 600, adelanto: 0 },
    ],
  });
  assert.equal(t.mismoPrecio, true);
  assert.equal(t.grupos.length, 1);
  assert.equal(t.grupos[0].toneladas, 25);
  assert.equal(t.subtotal, 1000);
  assert.equal(t.iva, 210);
  assert.equal(t.totalFlete, 1160);
});

test('varios viajes con distinto precio: subtotal por grupo + consolidado', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      { ...base, numero: '1', toneladas: 10, precioPorTn: 40, subtotal: 400, adelanto: 100 },
      { ...base, numero: '2', toneladas: 20, precioPorTn: 50, subtotal: 1000, adelanto: 0 },
    ],
  });
  assert.equal(t.mismoPrecio, false);
  assert.equal(t.grupos.length, 2);
  assert.equal(t.grupos[0].subtotal, 400);
  assert.equal(t.grupos[1].subtotal, 1000);
  assert.equal(t.subtotal, 1400);
  assert.equal(t.iva, 294);
  assert.equal(t.adelanto, 100);
  assert.equal(t.totalFlete, 1594);
});

console.log('liquidacion-contrato.util.spec.ts OK');
