/**
 * Pruebas del reparto de una imputación con dos cobros/pagos.
 * Ejecutar: npm run test:cc-imputacion-reparto
 */
import * as assert from 'node:assert/strict';
import { repartirImputacion } from './imputacion-reparto.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const pago = (id: string, disponible: number, fecha = '2026-10-01', createdAt = '2026-10-01T12:00:00Z') => ({
  id,
  disponible,
  fecha,
  createdAt,
});

test('ejemplo del ticket: factura 5.000 con 1.500 y 4.000 → 1.500 + 3.500, sobran 500', () => {
  assert.deepEqual(repartirImputacion(5000, [pago('mayor', 4000), pago('menor', 1500)]), [
    { pagoId: 'menor', importe: 1500 },
    { pagoId: 'mayor', importe: 3500 },
  ]);
});

test('no alcanzan: se usan completos y la factura queda parcial', () => {
  assert.deepEqual(repartirImputacion(5000, [pago('a', 1000), pago('b', 2000)]), [
    { pagoId: 'a', importe: 1000 },
    { pagoId: 'b', importe: 2000 },
  ]);
});

test('el menor solo ya cubre la factura: el mayor no aporta', () => {
  assert.deepEqual(repartirImputacion(800, [pago('a', 3000), pago('b', 1000)]), [
    { pagoId: 'b', importe: 800 },
    { pagoId: 'a', importe: 0 },
  ]);
});

test('compara lo disponible, no el total original', () => {
  // El cobro "a" era de 3.000 pero le quedan 1.000 → es el menor.
  assert.deepEqual(repartirImputacion(2500, [pago('a', 1000), pago('b', 2000)]), [
    { pagoId: 'a', importe: 1000 },
    { pagoId: 'b', importe: 1500 },
  ]);
});

test('empate de monto: primero el más antiguo por fecha, después por carga', () => {
  assert.deepEqual(
    repartirImputacion(1500, [pago('nuevo', 1000, '2026-10-05'), pago('viejo', 1000, '2026-10-01')]),
    [
      { pagoId: 'viejo', importe: 1000 },
      { pagoId: 'nuevo', importe: 500 },
    ],
  );
  assert.deepEqual(
    repartirImputacion(1500, [
      pago('segundo', 1000, '2026-10-01', '2026-10-01T15:00:00Z'),
      pago('primero', 1000, '2026-10-01', '2026-10-01T09:00:00Z'),
    ]),
    [
      { pagoId: 'primero', importe: 1000 },
      { pagoId: 'segundo', importe: 500 },
    ],
  );
});

test('redondea a centavos', () => {
  assert.deepEqual(repartirImputacion(100.1, [pago('a', 33.33), pago('b', 90)]), [
    { pagoId: 'a', importe: 33.33 },
    { pagoId: 'b', importe: 66.77 },
  ]);
});
