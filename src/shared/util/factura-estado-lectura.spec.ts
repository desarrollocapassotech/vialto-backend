/**
 * Cobro de facturas: por tramo el IVA entra al saldo; ARCA y sin tramo no cambian.
 * Ejecutar: npx ts-node --transpile-only src/shared/util/factura-estado-lectura.spec.ts
 */
import * as assert from 'node:assert/strict';
import {
  computeEstadoFacturaLectura,
  importeNetoFactura,
  importeOperativoFactura,
  importeTotalConIvaPorTramo,
} from './factura-estado-lectura';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const viajes3100 = [
  { id: 'v1', facturacionEstado: 'cobrado', monto: 1500 },
  { id: 'v2', facturacionEstado: 'cobrado', monto: 1600 },
];
const tramosUru = [
  { viajeId: 'v1', monto: 800, ivaPct: 0 },
  { viajeId: 'v1', monto: 700, ivaPct: 22 },
  { viajeId: 'v2', monto: 1600, ivaPct: 0 },
];

test('sin tramos: suma de viajes (o importe guardado si no hay viajes)', () => {
  assert.equal(importeOperativoFactura(0, viajes3100), 3100);
  assert.equal(importeOperativoFactura(99, []), 99);
});

test('por tramo sin ARCA: cobro = neto + IVA de cada tramo (3100 + 154 = 3254)', () => {
  const neto = importeNetoFactura(0, viajes3100, {
    facturarPorTramo: true,
    tramos: tramosUru,
  });
  assert.equal(neto, 3100);
  assert.equal(importeTotalConIvaPorTramo(neto, tramosUru, 0), 3254);
  assert.equal(
    importeOperativoFactura(0, viajes3100, {
      facturarPorTramo: true,
      tramos: tramosUru,
      ivaPctCabecera: 0,
    }),
    3254,
  );
});

test('tenant ARCA: por tramo no cambia el cobro (sigue el neto)', () => {
  assert.equal(
    importeOperativoFactura(0, viajes3100, {
      tieneArca: true,
      facturarPorTramo: true,
      tramos: tramosUru,
      ivaPctCabecera: 22,
    }),
    3100,
  );
});

test('por tramo sin ARCA: pagar solo el neto no la deja cobrada', () => {
  const { cobrado } = computeEstadoFacturaLectura({
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [{ importe: 3100 }],
    arcaEstado: null,
    tieneArca: false,
    facturarPorTramo: true,
    tramos: tramosUru,
    ivaPctCabecera: 0,
  });
  assert.equal(cobrado, false);
});

test('por tramo sin ARCA: cobrada al cubrir neto + IVA', () => {
  const { cobrado } = computeEstadoFacturaLectura({
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [{ importe: 3254 }],
    arcaEstado: null,
    tieneArca: false,
    facturarPorTramo: true,
    tramos: tramosUru,
    ivaPctCabecera: 0,
  });
  assert.equal(cobrado, true);
});

test('sin tramo: pagos = neto alcanza (comportamiento actual)', () => {
  const { cobrado } = computeEstadoFacturaLectura({
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [{ importe: 3100 }],
    arcaEstado: null,
    tieneArca: false,
    facturarPorTramo: false,
    ivaPctCabecera: 21,
  });
  assert.equal(cobrado, true);
});

console.log('factura-estado-lectura.spec.ts: OK');
