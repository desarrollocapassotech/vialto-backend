/**
 * Pruebas de los saldos del listado de cuentas.
 * Ejecutar: npm run test:cc-saldos
 */
import * as assert from 'node:assert/strict';
import { saldosPorContraparte } from './saldos-por-contraparte.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const fila = (contraparteId: string, moneda: string, tipo: string, importe: number) => ({
  contraparteId,
  moneda,
  tipo,
  importe,
});

test('resta los pagos de los cargos, por cuenta', () => {
  assert.deepEqual(
    saldosPorContraparte([
      fila('a', 'ARS', 'cargo', 1000),
      fila('a', 'ARS', 'pago', 400),
      fila('b', 'ARS', 'cargo', 50),
    ]),
    [
      { contraparteId: 'a', saldos: [{ moneda: 'ARS', saldo: 600 }] },
      { contraparteId: 'b', saldos: [{ moneda: 'ARS', saldo: 50 }] },
    ],
  );
});

test('no suma monedas distintas', () => {
  assert.deepEqual(
    saldosPorContraparte([fila('a', 'ARS', 'cargo', 1000), fila('a', 'USD', 'cargo', 10)]),
    [
      {
        contraparteId: 'a',
        saldos: [
          { moneda: 'ARS', saldo: 1000 },
          { moneda: 'USD', saldo: 10 },
        ],
      },
    ],
  );
});

test('un cobro a cuenta deja saldo negativo', () => {
  assert.deepEqual(saldosPorContraparte([fila('a', 'ARS', 'pago', 300)])[0].saldos, [
    { moneda: 'ARS', saldo: -300 },
  ]);
});

test('una cuenta saldada no informa saldo, y no quedan centavos de redondeo', () => {
  assert.deepEqual(
    saldosPorContraparte([
      fila('a', 'ARS', 'cargo', 0.3),
      fila('a', 'ARS', 'pago', 0.1),
      fila('a', 'ARS', 'pago', 0.2),
    ]),
    [{ contraparteId: 'a', saldos: [] }],
  );
});

test('ignora los créditos de anulación', () => {
  assert.deepEqual(
    saldosPorContraparte([fila('a', 'ARS', 'cargo', 100), fila('a', 'ARS', 'credito', 100)])[0].saldos,
    [{ moneda: 'ARS', saldo: 100 }],
  );
});
