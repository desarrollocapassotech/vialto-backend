/**
 * Neto de línea de factura: cantidad × precio, no un monto desfasado.
 * Ejecutar: npx ts-node --transpile-only src/modules/liquidaciones-arca/factura-conceptos.util.spec.ts
 */
import * as assert from 'node:assert/strict';
import { buildComprobanteCvlp } from './arca-cvlp.util';
import {
  defaultFacturaLineas,
  importeNetoLineaViaje,
} from './factura-conceptos.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('importeNetoLineaViaje usa cantidad × precio (2 decimales), no un monto desfasado', () => {
  const neto = importeNetoLineaViaje({
    monto: 1_009_024,
    cantidadFactura: 1,
    precioUnitarioFactura: 1_014_024,
  });
  assert.equal(neto, 1_014_024);
});

test('defaultFacturaLineas + CVLP: IVA e importe total sobre cantidad × precio', () => {
  const lineas = defaultFacturaLineas(
    { importe: 1_009_024, ivaPct: 21 },
    [
      {
        numero: '1',
        monto: 1_009_024,
        cantidadFactura: 1,
        precioUnitarioFactura: 1_014_024,
        origen: 'A',
        destino: 'B',
      },
    ],
  );
  assert.equal(lineas[0].importe, 1_014_024);

  const cvlp = buildComprobanteCvlp(
    {
      cuit: '20111111112',
      ptoVenta: 1,
      cbteTipo: 1,
      cbteNro: 1,
      fechaCbte: '20260827',
      concepto: 1,
      docTipo: 80,
      docNro: 30111111118,
      condicionIvaReceptorId: 1,
    },
    lineas,
    21,
  );
  assert.equal(cvlp.impNeto, 1_014_024);
  assert.equal(cvlp.impIva, 212_945.04);
  assert.equal(cvlp.impTotal, 1_226_969.04);
});
