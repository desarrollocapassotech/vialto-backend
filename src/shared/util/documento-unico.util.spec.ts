/**
 * Pruebas de la normalización de CUIT/ID fiscal y de la clave de persona del chofer.
 * Ejecutar: npm run test:documento-unico
 */
import * as assert from 'node:assert/strict';
import { claveDniChofer, normalizarIdFiscal } from './documento-unico.util';
import { formatCuit } from './cuit';

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

test('normalizarIdFiscal: mismo CUIT con y sin guiones', () => {
  assert.equal(normalizarIdFiscal('30-67863361-1'), '30678633611');
  assert.equal(normalizarIdFiscal('30678633611'), '30678633611');
  assert.equal(normalizarIdFiscal(' 30.678.633.611 '), '30678633611');
});

test('normalizarIdFiscal: RUT chileno conserva la K', () => {
  assert.equal(normalizarIdFiscal('12.345.678-k'), '12345678K');
});

test('normalizarIdFiscal: vacío → null', () => {
  assert.equal(normalizarIdFiscal(''), null);
  assert.equal(normalizarIdFiscal(' - '), null);
  assert.equal(normalizarIdFiscal(null), null);
  assert.equal(normalizarIdFiscal(undefined), null);
});

test('claveDniChofer: DNI y CUIT de la misma persona coinciden', () => {
  const porCuit = claveDniChofer(null, '20-12261362-4');
  assert.equal(porCuit, '12261362');
  assert.equal(claveDniChofer('12.261.362', null), porCuit);
  assert.equal(claveDniChofer('012261362', null), porCuit);
});

test('claveDniChofer: CUIT cargado en el campo DNI', () => {
  assert.equal(claveDniChofer('20122613624', null), '12261362');
});

test('claveDniChofer: el DNI manda sobre el CUIT', () => {
  assert.equal(claveDniChofer('30111222', '20122613624'), '30111222');
});

test('claveDniChofer: sin documento útil → null', () => {
  assert.equal(claveDniChofer(null, null), null);
  assert.equal(claveDniChofer('', '123'), null);
});

test('formatCuit: muestra con guiones lo que se guarda sin', () => {
  assert.equal(formatCuit('30678633611'), '30-67863361-1');
  assert.equal(formatCuit('30-67863361-1'), '30-67863361-1');
  assert.equal(formatCuit('12345678K'), '12345678K');
  assert.equal(formatCuit(null), '');
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron.');
