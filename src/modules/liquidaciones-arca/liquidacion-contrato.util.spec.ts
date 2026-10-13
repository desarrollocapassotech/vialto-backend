/**
 * Agrupación de flete para el PDF contrato proveedor.
 * Ejecutar: npx ts-node --transpile-only src/modules/liquidaciones-arca/liquidacion-contrato.util.spec.ts
 */
const assert = {
  equal: (actual: unknown, expected: unknown, message?: string) => {
    if (actual !== expected) {
      throw new Error(
        message ||
          `Aserción fallida: esperado ${JSON.stringify(expected)}, pero se obtuvo ${JSON.stringify(actual)}`,
      );
    }
  },
};

import {
  buildLiquidacionContratoTotales,
  encabezadoContratoProveedor,
  resolverDocsViajeContrato,
} from './liquidacion-contrato.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const base = {
  numero: '1',
  origen: 'A',
  destino: 'B',
  fechaCarga: '2026-01-10',
  fechaDescarga: '2026-01-12',
  choferNombre: 'Juan',
  mercaderia: 'Soja',
  crt: 'CRT-1',
  mic: 'MIC-1',
  remito: null,
  adelanto: 0,
  moneda: 'USD',
};

test('un viaje: un solo grupo y IVA sobre el subtotal', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      {
        ...base,
        toneladas: 30,
        precioPorTn: 50,
        subtotal: 1500,
        adelanto: 200,
      },
    ],
  });
  assert.equal(t.cantViajes, 1);
  assert.equal(t.mismoPrecio, true);
  assert.equal(t.grupos.length, 1);
  assert.equal(t.subtotal, 1500);
  assert.equal(t.iva, 315);
  assert.equal(t.adelanto, 200);
  assert.equal(t.totalFlete, 1615);
});

test('varios viajes con el mismo precio x TN: una sola vista', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      { ...base, numero: '1', toneladas: 10, precioPorTn: 40, subtotal: 400, adelanto: 50 },
      { ...base, numero: '2', toneladas: 15, precioPorTn: 40, subtotal: 600, adelanto: 0 },
    ],
  });
  assert.equal(t.mismoPrecio, true);
  assert.equal(t.grupos.length, 1);
  assert.equal(t.grupos[0].toneladas, 25);
  assert.equal(t.subtotal, 1000);
  assert.equal(t.iva, 210);
  assert.equal(t.totalFlete, 1160);
});

test('varios viajes con distinto precio: subtotal por grupo + consolidado', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      { ...base, numero: '1', toneladas: 10, precioPorTn: 40, subtotal: 400, adelanto: 100 },
      { ...base, numero: '2', toneladas: 20, precioPorTn: 50, subtotal: 1000, adelanto: 0 },
    ],
  });
  assert.equal(t.mismoPrecio, false);
  assert.equal(t.grupos.length, 2);
  assert.equal(t.grupos[0].subtotal, 400);
  assert.equal(t.grupos[1].subtotal, 1000);
  assert.equal(t.subtotal, 1400);
  assert.equal(t.iva, 294);
  assert.equal(t.adelanto, 100);
  assert.equal(t.totalFlete, 1594);
});

test('encabezado sin proveedor configurado devuelve título y subtítulo estándar', () => {
  const sinConfig = encabezadoContratoProveedor(null);
  assert.equal(sinConfig.titulo, 'LIQUIDACIÓN DE FLETE');
  assert.equal(sinConfig.subtitulo, 'Contrato / liquidación a proveedor');

  const vacio = encabezadoContratoProveedor('');
  assert.equal(vacio.titulo, 'LIQUIDACIÓN DE FLETE');
  assert.equal(vacio.subtitulo, 'Contrato / liquidación a proveedor');
});

test('encabezado con proveedor configurado genera el título dinámico en mayúsculas sin subtítulo', () => {
  const arg = encabezadoContratoProveedor('LSF CARGAS SAS (ARGENTINA)');
  assert.equal(arg.titulo, 'CONTRATO PROVEEDOR POR LSF CARGAS SAS (ARGENTINA)');
  assert.equal(arg.subtitulo, null);

  const uy = encabezadoContratoProveedor('lsf cargas & comex sas (uruguay)');
  assert.equal(uy.titulo, 'CONTRATO PROVEEDOR POR LSF CARGAS & COMEX SAS (URUGUAY)');
  assert.equal(uy.subtitulo, null);
});

test('encabezado con espacios en blanco realiza trim adecuadamente', () => {
  const espaciado = encabezadoContratoProveedor('   LSF Cargas SAS   ');
  assert.equal(espaciado.titulo, 'CONTRATO PROVEEDOR POR LSF CARGAS SAS');
  assert.equal(espaciado.subtitulo, null);

  const soloEspacios = encabezadoContratoProveedor('   ');
  assert.equal(soloEspacios.titulo, 'LIQUIDACIÓN DE FLETE');
  assert.equal(soloEspacios.subtitulo, 'Contrato / liquidación a proveedor');
});

test('resolverDocsViajeContrato prioriza MIC desde ID 1 y Remito desde ID 2', () => {
  const docs = resolverDocsViajeContrato({
    numeroIdentificacionPersonalizado: 'MIC-9921',
    idPropio2: 'REM-1004',
    documentoAduanero: {
      crtNumero: 'CRT-555',
      micNumero: 'MIC-NOMINA-VIEJA',
      remito: 'REM-VIEJO',
    },
  });
  assert.equal(docs.crt, 'CRT-555');
  assert.equal(docs.mic, 'MIC-9921');
  assert.equal(docs.remito, 'REM-1004');
});

test('resolverDocsViajeContrato aplica trim en IDs personalizados', () => {
  const docs = resolverDocsViajeContrato({
    numeroIdentificacionPersonalizado: '   MIC-ESPACIADO   ',
    idPropio2: '   REM-ESPACIADO   ',
  });
  assert.equal(docs.mic, 'MIC-ESPACIADO');
  assert.equal(docs.remito, 'REM-ESPACIADO');
  assert.equal(docs.crt, null);
});

test('resolverDocsViajeContrato fallback a documento aduanero si IDs personalizados están vacíos', () => {
  const docs = resolverDocsViajeContrato({
    numeroIdentificacionPersonalizado: '   ',
    idPropio2: null,
    documentoAduanero: {
      crtNumero: 'CRT-777',
      micNumero: 'MIC-FALLBACK',
      remitoNumero: 'REM-FALLBACK',
    },
  });
  assert.equal(docs.crt, 'CRT-777');
  assert.equal(docs.mic, 'MIC-FALLBACK');
  assert.equal(docs.remito, 'REM-FALLBACK');
});

test('resolverDocsViajeContrato retorna null en todos los campos si no hay datos', () => {
  const docs = resolverDocsViajeContrato(null);
  assert.equal(docs.crt, null);
  assert.equal(docs.mic, null);
  assert.equal(docs.remito, null);

  const vacio = resolverDocsViajeContrato({});
  assert.equal(vacio.crt, null);
  assert.equal(vacio.mic, null);
  assert.equal(vacio.remito, null);
});

console.log('liquidacion-contrato.util.spec.ts OK');
