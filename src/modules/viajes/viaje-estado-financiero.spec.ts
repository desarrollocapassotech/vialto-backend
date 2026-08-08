/**
 * Pruebas del cálculo de los indicadores derivados de facturación/liquidación de un viaje.
 * Ejecutar: npm run test:viaje-estado-financiero
 */
import * as assert from 'node:assert/strict';
import { mapFacturacionEstado, mapLiquidacionEstado } from './viaje-estado-financiero';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('sin factura vinculada → sin_facturar', () => {
  assert.equal(mapFacturacionEstado(null, false, true), 'sin_facturar');
  assert.equal(mapFacturacionEstado(null, false, false), 'sin_facturar');
});

test('tenant sin ARCA: factura manual (arcaEstado null) cuenta como facturada de una', () => {
  assert.equal(mapFacturacionEstado({ arcaEstado: null }, false, false), 'facturado');
  assert.equal(mapFacturacionEstado({ arcaEstado: null }, true, false), 'cobrado');
});

test('tenant con ARCA: factura creada pero todavía no emitida sigue sin_facturar', () => {
  assert.equal(mapFacturacionEstado({ arcaEstado: null }, false, true), 'sin_facturar');
});

test('tenant con ARCA: estados intermedios de emisión', () => {
  assert.equal(mapFacturacionEstado({ arcaEstado: 'pendiente_cae' }, false, true), 'esperando_afip');
  assert.equal(mapFacturacionEstado({ arcaEstado: 'error' }, false, true), 'error_afip');
  assert.equal(mapFacturacionEstado({ arcaEstado: 'autorizado' }, false, true), 'facturado');
  assert.equal(mapFacturacionEstado({ arcaEstado: 'autorizado' }, true, true), 'cobrado');
});

test('bug de re-facturación: factura anulada vuelve a estar disponible (fix histórico)', () => {
  assert.equal(mapFacturacionEstado({ arcaEstado: 'anulado' }, false, true), 'anulado');
  // Anulado no es lo mismo que cobrado, aunque `cobrado` haya quedado true de un estado previo.
  assert.equal(mapFacturacionEstado({ arcaEstado: 'anulado' }, true, true), 'anulado');
});

test('liquidación: mapeo de estados AFIP', () => {
  assert.equal(mapLiquidacionEstado(null), 'sin_liquidar');
  assert.equal(mapLiquidacionEstado('borrador'), 'esperando_afip');
  assert.equal(mapLiquidacionEstado('pendiente_cae'), 'esperando_afip');
  assert.equal(mapLiquidacionEstado('autorizado'), 'liquidado');
  assert.equal(mapLiquidacionEstado('error'), 'error_afip');
  assert.equal(mapLiquidacionEstado('anulado'), 'anulado');
});
