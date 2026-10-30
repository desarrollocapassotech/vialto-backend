/**
 * Pruebas del comprobante manual (tipo / punto de venta / número para el Libro IVA).
 * Ejecutar: npm run test:comprobante-manual
 */
import * as assert from 'node:assert/strict';
import {
  formatNumeroComprobanteManual,
  parsearNumeroComprobante,
  resolverComprobanteManual,
} from './comprobante-manual.util';

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

test('formatea con letra, punto de venta y número', () => {
  assert.equal(formatNumeroComprobanteManual(1, 1, 123), 'A 0001-00000123');
  assert.equal(formatNumeroComprobanteManual(11, 12345, 94), 'C 12345-00000094');
  assert.equal(formatNumeroComprobanteManual(206, 2, 15), 'FCE B 0002-00000015');
});

for (const [texto, esperado] of [
  ['A 0001-00000123', 'A 0001-00000123'],
  ['a-0001-123', 'A 0001-00000123'],
  ['A0001-123', 'A 0001-00000123'],
  ['Factura C 00001-00000094', 'C 0001-00000094'],
  ['  B   3 - 7 ', 'B 0003-00000007'],
  ['FCE A 2-15', 'FCE A 0002-00000015'],
] as const) {
  test(`parsea "${texto}"`, () => {
    assert.equal(parsearNumeroComprobante(texto)?.numero, esperado);
  });
}

for (const texto of ['0001-00000123', '123', 'X 0001-1', 'A 0000-00000001', 'A 123456-1', '', null]) {
  test(`no parsea ${JSON.stringify(texto)}`, () => {
    assert.equal(parsearNumeroComprobante(texto), null);
  });
}

test('resolver: campos separados ganan sobre el texto', () => {
  const r = resolverComprobanteManual({ cbteTipo: 6, ptoVenta: 4, cbteNro: 9, numero: 'A 1-1' });
  assert.deepEqual(r, { cbteTipo: 6, ptoVenta: 4, cbteNro: 9, numero: 'B 0004-00000009' });
});

test('resolver: sin campos separados interpreta el texto', () => {
  assert.equal(resolverComprobanteManual({ numero: 'C 1-2' }).cbteTipo, 11);
});

test('resolver: incompleto, tipo inválido o fuera de rango tira error', () => {
  assert.throws(() => resolverComprobanteManual({ cbteTipo: 1, ptoVenta: 1 }));
  assert.throws(() => resolverComprobanteManual({ cbteTipo: 99, ptoVenta: 1, cbteNro: 1 }));
  assert.throws(() => resolverComprobanteManual({ cbteTipo: 1, ptoVenta: 0, cbteNro: 1 }));
  assert.throws(() => resolverComprobanteManual({ cbteTipo: 1, ptoVenta: 1, cbteNro: 1.5 }));
  assert.throws(() => resolverComprobanteManual({ numero: '0001-00000123' }));
  assert.throws(() => resolverComprobanteManual({}));
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron');
