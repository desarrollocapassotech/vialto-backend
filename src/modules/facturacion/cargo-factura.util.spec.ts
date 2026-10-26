import * as assert from 'node:assert/strict';
import {
  conceptoAnulacion,
  conceptoCargoFactura,
  estadoCargoFactura,
  importeCargoFactura,
} from './cargo-factura.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('importeCargoFactura: con ivaMonto persistido suma neto + ivaMonto', () => {
  assert.equal(
    importeCargoFactura({ importe: 3000, ivaMonto: 630 }),
    3630,
  );
});

test('importeCargoFactura: con alícuota 21% sin ivaMonto calcula total con IVA', () => {
  assert.equal(
    importeCargoFactura({ importe: 3000, ivaPct: 21 }),
    3630,
  );
});

test('importeCargoFactura: con alícuota 10.5% calcula total con IVA', () => {
  assert.equal(
    importeCargoFactura({ importe: 1000, ivaPct: 10.5 }),
    1105,
  );
});

test('importeCargoFactura: exenta o sin IVA (0%) mantiene el neto inalterado', () => {
  assert.equal(
    importeCargoFactura({ importe: 3000, ivaPct: 0 }),
    3000,
  );
  assert.equal(
    importeCargoFactura({ importe: 3000, ivaPct: null }),
    3000,
  );
});

test('importeCargoFactura: por tramos calcula el total con IVA de los tramos', () => {
  const tramos = [
    { viajeId: 'v1', monto: 1000, ivaPct: 21 },
    { viajeId: 'v2', monto: 2000, ivaPct: 0 },
  ];
  assert.equal(
    importeCargoFactura({
      importe: 3000,
      facturarPorTramo: true,
      tramos,
      ivaPct: 0,
    }),
    3210,
  );
});

test('conceptoCargoFactura: factura estándar y con letra', () => {
  assert.equal(conceptoCargoFactura(), 'FACTURA');
  assert.equal(conceptoCargoFactura(1), 'FACTURA A');
  assert.equal(conceptoCargoFactura(6), 'FACTURA B');
  assert.equal(conceptoCargoFactura(11), 'FACTURA C');
});

test('conceptoAnulacion: nota de crédito/débito y anulación general', () => {
  assert.equal(conceptoAnulacion(), 'ANULACION');
  assert.equal(conceptoAnulacion(3), 'NOTA DE CRÉDITO A');
  assert.equal(conceptoAnulacion(8), 'NOTA DE CRÉDITO B');
  assert.equal(conceptoAnulacion(2), 'NOTA DE DÉBITO A');
});

test('estadoCargoFactura: según cobrado y totalPagado', () => {
  assert.equal(estadoCargoFactura(true, 3630), 'cancelado');
  assert.equal(estadoCargoFactura(false, 1000), 'parcial');
  assert.equal(estadoCargoFactura(false, 0), 'pendiente');
});

console.log('cargo-factura.util.spec.ts: OK');
