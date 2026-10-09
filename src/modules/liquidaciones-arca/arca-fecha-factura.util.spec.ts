/**
 * Pruebas de la fecha de emisión de facturas ARCA (`resolveFechaCbteFactura`).
 * Ejecutar: npm run test:arca-fecha-factura
 */
import * as assert from 'node:assert/strict';
import { resolveFechaCbteFactura } from './arca.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

// Fecha sin hora como la guarda el backend: medianoche UTC.
const fecha = (iso: string) => new Date(iso);
const HOY = '20261009';

test('devuelve exactamente la fecha elegida (sin correrla a hoy)', () => {
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-09'), null, HOY), '20261009');
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-06'), null, HOY), '20261006');
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-12'), null, HOY), '20261012');
});

test('admite los extremos de la ventana de AFIP (±5 días)', () => {
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-04'), null, HOY), '20261004');
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-14'), null, HOY), '20261014');
});

test('rechaza fechas fuera de la ventana con un mensaje claro', () => {
  assert.throws(() => resolveFechaCbteFactura(fecha('2026-10-03'), null, HOY));
  assert.throws(
    () => resolveFechaCbteFactura(fecha('2026-10-15'), null, HOY),
    /entre el 04\/10\/2026 y el 14\/10\/2026/,
  );
});

test('rechaza una fecha anterior al último comprobante del punto de venta', () => {
  assert.throws(
    () => resolveFechaCbteFactura(fecha('2026-10-07'), '20261008', HOY),
    /anterior a la del último comprobante.*08\/10\/2026/,
  );
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-08'), '20261008', HOY), '20261008');
});

test('calcula la ventana cruzando fin de mes', () => {
  assert.equal(resolveFechaCbteFactura(fecha('2026-10-27'), null, '20261101'), '20261027');
  assert.throws(() => resolveFechaCbteFactura(fecha('2026-10-26'), null, '20261101'));
});

console.log('arca-fecha-factura: OK');
