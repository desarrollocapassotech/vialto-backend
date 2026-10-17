/**
 * Pruebas del label personalizado de "Producto" (plural de respaldo por regla).
 * Ejecutar: npm run test:producto-label
 */
import * as assert from 'node:assert/strict';
import { labelEnFrase, pluralizarCastellano, productoLabels } from './producto-label.util';

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

for (const [singular, plural] of [
  ['Grano', 'Granos'],
  ['Cereal', 'Cereales'],
  ['Lápiz', 'Lápices'],
  ['Mercadería', 'Mercaderías'],
  ['Tipo de carga', 'Tipos de carga'],
  ['GRANO', 'GRANOS'],
  ['CEREAL', 'CEREALES'],
  ['Tórax', 'Tórax'],
]) {
  test(`pluralizarCastellano: ${singular} → ${plural}`, () => {
    assert.equal(pluralizarCastellano(singular), plural);
  });
}

test('productoLabels: sin label usa Producto/Productos', () => {
  assert.deepEqual(productoLabels(null), { singular: 'Producto', plural: 'Productos' });
  assert.deepEqual(productoLabels({ productoLabel: '  ' }), {
    singular: 'Producto',
    plural: 'Productos',
  });
});

test('productoLabels: usa el plural guardado, o la regla si falta', () => {
  assert.deepEqual(productoLabels({ productoLabel: 'Grano', productoLabelPlural: 'Granos' }), {
    singular: 'Grano',
    plural: 'Granos',
  });
  assert.equal(productoLabels({ productoLabel: 'Cereal', productoLabelPlural: null }).plural, 'Cereales');
});

test('labelEnFrase: minúscula inicial salvo siglas', () => {
  assert.equal(labelEnFrase('Grano'), 'grano');
  assert.equal(labelEnFrase('Tipo de carga'), 'tipo de carga');
  assert.equal(labelEnFrase('CPE'), 'CPE');
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron.');
