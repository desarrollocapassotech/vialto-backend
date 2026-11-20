/**
 * Pruebas de compras vinculadas a viajes (reparto y gastos protegidos), sin DB.
 * Ejecutar: npm run test:compra-viajes
 */
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  mergeGastosConCompras,
  netoCompra,
  normalizarRepartoCompra,
  reescalarReparto,
} from './compra-viajes';

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

test('neto: importeNeto si hay IVA, si no el importe', () => {
  assert.equal(netoCompra({ importe: 121, importeNeto: 100 }), 100);
  assert.equal(netoCompra({ importe: 50, importeNeto: null }), 50);
});

test('reparto: sin viajes es válido (la vinculación es opcional)', () => {
  assert.deepEqual(normalizarRepartoCompra([], 100), []);
});

test('reparto: tiene que sumar el neto (tolerancia de un centavo)', () => {
  assert.deepEqual(
    normalizarRepartoCompra([{ viajeId: 'a', importe: 33.33 }, { viajeId: 'b', importe: 66.67 }], 100),
    [{ viajeId: 'a', importe: 33.33 }, { viajeId: 'b', importe: 66.67 }],
  );
  assert.throws(() => normalizarRepartoCompra([{ viajeId: 'a', importe: 90 }], 100), BadRequestException);
});

test('reparto: viaje repetido o importe 0 → 400', () => {
  assert.throws(
    () => normalizarRepartoCompra([{ viajeId: 'a', importe: 50 }, { viajeId: 'a', importe: 50 }], 100),
    BadRequestException,
  );
  assert.throws(
    () => normalizarRepartoCompra([{ viajeId: 'a', importe: 100 }, { viajeId: 'b', importe: 0 }], 100),
    BadRequestException,
  );
});

test('reescalar: proporcional y el redondeo va al último, suma exacta', () => {
  const r = reescalarReparto([{ viajeId: 'a', importe: 50 }, { viajeId: 'b', importe: 25 }, { viajeId: 'c', importe: 25 }], 100);
  assert.deepEqual(r.map((v) => v.importe), [50, 25, 25]);
  const r2 = reescalarReparto([{ viajeId: 'a', importe: 1 }, { viajeId: 'b', importe: 1 }, { viajeId: 'c', importe: 1 }], 100);
  assert.equal(r2.reduce((s, v) => s + v.importe, 0), 100);
});

test('merge: conserva las líneas de compras y descarta las que llegan del formulario', () => {
  const actuales = [
    { descripcion: 'Peaje', monto: 10, moneda: 'ARS' },
    { descripcion: 'Compra · Gomería · A 1', monto: 50, moneda: 'ARS', ccCompraId: 'm1' },
  ];
  // El formulario manda el peaje editado, una copia de la compra sin ccCompraId y un gasto nuevo.
  const entrantes = [
    { descripcion: 'Peaje', monto: 12, moneda: 'ARS' },
    { descripcion: 'Compra · Gomería · A 1', monto: 50, moneda: 'ARS' },
    { descripcion: 'Estadía', monto: 5, moneda: 'USD' },
  ];
  const r = mergeGastosConCompras(entrantes, actuales);
  assert.deepEqual(r.map((g) => g.descripcion), ['Peaje', 'Estadía', 'Compra · Gomería · A 1']);
  assert.equal(r[0].monto, 12);
  assert.equal(r[2].ccCompraId, 'm1');
});

test('merge: sacar todos los gastos manuales no borra los de compras', () => {
  const r = mergeGastosConCompras([], [{ descripcion: 'Compra · X', monto: 1, moneda: 'ARS', ccCompraId: 'm' }]);
  assert.equal(r.length, 1);
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
