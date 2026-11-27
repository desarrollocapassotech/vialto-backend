/**
 * Nota de crédito de una factura (auditoría IVA, nov 2026, H3): tiene que igualar
 * neto, IVA, total y alícuotas de lo que se autorizó, no rearmarse desde los viajes.
 * Escenarios N1-N3 del informe "Auditoría de cálculos de IVA" del 27/11/2026.
 * Ejecutar: npm run test:nota-credito
 */
import * as assert from 'node:assert/strict';
import { buildComprobanteCvlp } from './arca-cvlp.util';
import { buildFacturaConceptosList, defaultFacturaLineas } from './factura-conceptos.util';
import {
  conceptosNotaCreditoDesdeAutorizado,
  diferenciaNotaCreditoFactura,
} from './nota-credito-factura.util';
import type { ConceptoFacturable } from './arca-cvlp.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const cab = {} as Parameters<typeof buildComprobanteCvlp>[0];

/** Lo que guarda el log al emitir: `auditMetadata` = comprobante armado con las líneas. */
function emitir(lineas: ConceptoFacturable[], ivaPctDefault: number) {
  return buildComprobanteCvlp(cab, lineas, ivaPctDefault);
}

function anular(metadata: ReturnType<typeof emitir>, ivaPctDefault: number) {
  const conceptos = conceptosNotaCreditoDesdeAutorizado(metadata);
  assert.ok(conceptos);
  return buildComprobanteCvlp(cab, conceptos, ivaPctDefault);
}

test('N1: tramos 21% / 10,5% / 0% con IVA general 0: la NC iguala la factura', () => {
  const factura = emitir(
    [
      { descripcion: 'Tramo AR', importe: 200, ivaPct: 21 },
      { descripcion: 'Tramo 2', importe: 300, ivaPct: 10.5 },
      { descripcion: 'Tramo exento', importe: 500, ivaPct: 0 },
    ],
    0,
  );
  assert.equal(factura.impTotal, 1073.5);
  const nc = anular(factura, 0);
  assert.equal(nc.impTotal, 1073.5);
  assert.deepEqual(nc.alicuotasIva, factura.alicuotasIva);
  assert.equal(
    diferenciaNotaCreditoFactura(nc, { impNeto: factura.impNeto, impIva: factura.impIva }),
    null,
  );
});

test('N1 con el armado viejo (desde los viajes) daba IVA 0 y ahora se frenaría', () => {
  const viejo = buildComprobanteCvlp(
    cab,
    buildFacturaConceptosList(
      defaultFacturaLineas({ importe: 1000, ivaPct: 0 }, [
        { numero: '1', monto: 1000 },
      ]),
      0,
    ),
    0,
  );
  assert.equal(viejo.impIva, 0);
  assert.notEqual(
    diferenciaNotaCreditoFactura(viejo, { impNeto: 1000, impIva: 73.5 }),
    null,
  );
});

test('N3: dos viajes (cliente principal y secundario) al 21%: la NC lleva los dos', () => {
  const factura = emitir(
    [
      { descripcion: 'Viaje A', importe: 1000, ivaPct: 21 },
      { descripcion: 'Viaje B (secundario)', importe: 500, ivaPct: 21 },
    ],
    21,
  );
  const nc = anular(factura, 21);
  assert.equal(nc.impNeto, 1500);
  assert.equal(nc.impTotal, 1815);
});

test('Renglones de la NC conservan descripción, cantidad y unitario', () => {
  const factura = emitir(
    [{ producto: '#12', descripcion: 'Rosario - Zárate', cantidad: 30, precioUnitario: 10, importe: 300, ivaPct: 21 }],
    21,
  );
  const conceptos = conceptosNotaCreditoDesdeAutorizado(factura)!;
  assert.equal(conceptos[0].producto, '#12');
  assert.equal(conceptos[0].descripcion, 'Rosario - Zárate');
  assert.equal(conceptos[0].cantidad, 30);
  assert.equal(conceptos[0].precioUnitario, 10);
});

test('Sin renglones en el log devuelve null (se usa el armado de respaldo)', () => {
  assert.equal(conceptosNotaCreditoDesdeAutorizado(null), null);
  assert.equal(conceptosNotaCreditoDesdeAutorizado({ items: [] }), null);
});
