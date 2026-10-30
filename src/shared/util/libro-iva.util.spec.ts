/**
 * Pruebas del Libro IVA: formato de los TXT (diseño de registros de ARCA) y lectura de ArcaLog.
 * Ejecutar: npm run test:libro-iva
 */
import * as assert from 'node:assert/strict';
import {
  agruparAlicuotas,
  caeDeRespuestaArca,
  campoImporte,
  campoTipoCambio,
  comprobanteDeRequestArca,
  documentoDesdeIdFiscal,
  generarTxtLibroIva,
  lineaComprasCbte,
  lineasComprasAlicuotas,
  lineasVentasAlicuotas,
  lineaVentasCbte,
  logAutorizadoPorCae,
  type LibroIvaComprobante,
} from './libro-iva.util';

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

function comprobante(p: Partial<LibroIvaComprobante> = {}): LibroIvaComprobante {
  return {
    origenTipo: 'factura',
    origenId: 'f1',
    fecha: '2026-10-15',
    cbteTipo: 1,
    ptoVenta: 3,
    cbteNro: 70,
    numeroTexto: '0003-00000070',
    docTipo: 80,
    docNro: '30712345678',
    contraparte: 'Acopio Ñandú S.A.',
    alicuotas: [{ pct: 21, neto: 1000, iva: 210 }],
    noGravado: 0,
    exento: 0,
    otrosTributos: 0,
    total: 1210,
    moneda: 'PES',
    cotizacion: 1,
    cae: '12345678901234',
    origen: 'arca',
    anulacion: false,
    prueba: false,
    comision: null,
    ivaComision: null,
    observaciones: [],
    incompleto: null,
    ...p,
  };
}

const informante = { cuit: '30711111119', razonSocial: 'NyM Logística SRL' };

test('importe: 13 enteros + 2 decimales, negativo con "-" adelante', () => {
  assert.equal(campoImporte(1210.5), '000000000121050');
  assert.equal(campoImporte(0), '000000000000000');
  assert.equal(campoImporte(-15.2), '-00000000001520');
  assert.equal(campoImporte(-15.2).length, 15);
});

test('tipo de cambio: 4 enteros + 6 decimales', () => {
  assert.equal(campoTipoCambio(1), '0001000000');
  assert.equal(campoTipoCambio(1234.5), '1234500000');
});

test('ventas: cabecera de 266 y alícuotas de 62 caracteres', () => {
  const c = comprobante({ alicuotas: [{ pct: 21, neto: 1000, iva: 210 }, { pct: 10.5, neto: 100, iva: 10.5 }] });
  const linea = lineaVentasCbte(c);
  assert.equal(linea.length, 266);
  assert.equal(linea.slice(0, 8), '20261015');
  assert.equal(linea.slice(8, 11), '001');
  assert.equal(linea.slice(11, 16), '00003');
  assert.equal(linea.slice(56, 58), '80');
  assert.equal(linea.slice(228, 231), 'PES');
  assert.equal(linea.slice(241, 242), '2'); // cantidad de alícuotas
  const alic = lineasVentasAlicuotas(c);
  assert.equal(alic.length, 2);
  assert.ok(alic.every((l) => l.length === 62));
  assert.equal(alic[0].slice(43, 47), '0005');
  assert.equal(alic[1].slice(43, 47), '0004');
});

test('ventas sin alícuotas: informa una al 0% y código de operación', () => {
  const c = comprobante({ alicuotas: [], exento: 500, total: 500 });
  assert.equal(lineaVentasCbte(c).slice(241, 243), '1E');
  assert.equal(lineasVentasAlicuotas(c)[0].slice(43, 47), '0003');
});

test('compras: cabecera de 325 y alícuotas de 84; 060 lleva emisor e IVA comisión', () => {
  const c = comprobante({ cbteTipo: 60, ivaComision: 42, origenTipo: 'liquidacion' });
  const linea = lineaComprasCbte(c, informante);
  assert.equal(linea.length, 325);
  assert.equal(linea.slice(269, 280), '30711111119');
  assert.equal(linea.slice(280, 310).trim(), 'NyM Logística SRL');
  assert.equal(linea.slice(310, 325), campoImporte(42));
  assert.equal(linea.slice(239, 254), campoImporte(210)); // crédito fiscal computable
  const alic = lineasComprasAlicuotas(c);
  assert.ok(alic.every((l) => l.length === 84));
});

test('compras de otro tipo: sin emisor/corredor', () => {
  const linea = lineaComprasCbte(comprobante({ cbteTipo: 3 }), informante);
  assert.equal(linea.slice(269, 280), '00000000000');
  assert.equal(linea.slice(310, 325), campoImporte(0));
});

test('compras clase C: 0 alícuotas y ningún registro', () => {
  const c = comprobante({ cbteTipo: 11, alicuotas: [], total: 5000 });
  assert.equal(lineaComprasCbte(c, informante).slice(237, 238), '0');
  assert.deepEqual(lineasComprasAlicuotas(c), []);
});

test('texto: nombres largos se cortan a 30 y sin caracteres fuera de Latin-1', () => {
  const linea = lineaVentasCbte(comprobante({ contraparte: 'Transportes “El Rápido” — una razón social muy larga' }));
  assert.equal(linea.length, 266);
  assert.ok(!/[“”—]/.test(linea));
});

test('TXT: excluye comprobantes incompletos y codifica en Latin-1', () => {
  const txt = generarTxtLibroIva({
    tipo: 'ventas',
    desde: '2026-10-01',
    hasta: '2026-10-31',
    esPrueba: false,
    informante,
    comprobantes: [
      comprobante(),
      comprobante({ cbteTipo: null, numeroTexto: '123', origen: 'manual', cae: null }),
    ],
  });
  assert.equal(txt.excluidos.length, 1);
  assert.equal(txt.archivos[0].nombre, 'LIBRO_IVA_DIGITAL_VENTAS_CBTE_20261001_20261031.txt');
  const contenido = Buffer.from(txt.archivos[0].contenidoBase64, 'base64');
  assert.equal(contenido.length, 266 + 2); // una línea + CRLF, Ñ en 1 byte
  assert.equal(contenido.toString('latin1').includes('Ñandú'), true);
});

test('TXT compras: anulación de CVLP con 060 en negativo va con signo', () => {
  const c = comprobante({
    cbteTipo: 60,
    origenTipo: 'liquidacion',
    anulacion: true,
    negativoEnTxt: true,
    comision: 200,
    ivaComision: 42,
  });
  const txt = generarTxtLibroIva({
    tipo: 'compras',
    desde: '2026-10-01',
    hasta: '2026-10-31',
    esPrueba: false,
    informante,
    comprobantes: [c],
  });
  assert.equal(txt.excluidos.length, 0);
  const cbte = Buffer.from(txt.archivos[0].contenidoBase64, 'base64').toString('latin1');
  const alic = Buffer.from(txt.archivos[1].contenidoBase64, 'base64').toString('latin1');
  assert.equal(cbte.length, 325 + 2);
  assert.equal(cbte.slice(104, 119), campoImporte(-c.total));
  assert.equal(cbte.slice(239, 254), campoImporte(-210)); // crédito fiscal computable
  assert.equal(cbte.slice(310, 325), campoImporte(-42)); // IVA comisión
  assert.equal(alic.length, 84 + 2);
  assert.equal(alic.slice(50, 65), campoImporte(-1000)); // neto gravado
  // La NC/ND de ARCA sigue en positivo.
  const nc = lineaComprasCbte(comprobante({ cbteTipo: 3, anulacion: true }), informante);
  assert.equal(nc.slice(104, 119), campoImporte(c.total));
});

test('agrupa alícuotas por % y descarta vacías', () => {
  assert.deepEqual(
    agruparAlicuotas([
      { base: 100, pct: 21 },
      { base: 50, pct: 21 },
      { base: 30, pct: 0 },
      { base: 0, pct: 10.5 },
    ]),
    [
      { pct: 21, neto: 150, iva: 31.5 },
      { pct: 0, neto: 30, iva: 0 },
    ],
  );
});

test('documento desde ID fiscal', () => {
  assert.deepEqual(documentoDesdeIdFiscal('30-71234567-8'), { docTipo: 80, docNro: '30712345678' });
  assert.deepEqual(documentoDesdeIdFiscal('25123456'), { docTipo: 96, docNro: '25123456' });
  assert.deepEqual(documentoDesdeIdFiscal(null), { docTipo: 99, docNro: '0' });
});

test('ArcaLog FECAESolicitar: lee el pedido y el CAE aprobado', () => {
  const requestBody = {
    method: 'FECAESolicitar',
    params: {
      Auth: '***',
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta: 3, CbteTipo: 60 },
        FeDetReq: {
          FECAEDetRequest: {
            DocTipo: 80,
            DocNro: 20301234567,
            CbteDesde: 15,
            CbteHasta: 15,
            CbteFch: 20261020,
            ImpTotal: 1210,
            ImpTotConc: 0,
            ImpNeto: 1000,
            ImpOpEx: 0,
            ImpIVA: 210,
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            Iva: { AlicIva: [{ Id: 5, BaseImp: 1000, Importe: 210 }] },
          },
        },
      },
    },
  };
  const responseBody = {
    FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A', CAE: '7654' }] } },
  };
  const c = comprobanteDeRequestArca(requestBody, responseBody);
  assert.ok(c);
  assert.equal(c.cbteTipo, 60);
  assert.equal(c.cbteNro, 15);
  assert.equal(c.fecha, '2026-10-20');
  assert.equal(c.docNro, '20301234567');
  assert.deepEqual(c.alicuotas, [{ pct: 21, neto: 1000, iva: 210 }]);
  assert.equal(caeDeRespuestaArca(responseBody), '7654');
  const rechazado = { responseBody: { FECAESolicitarResult: { Errors: { Err: { Msg: 'x' } } } } };
  const aprobado = { responseBody };
  assert.equal(logAutorizadoPorCae([rechazado, aprobado], '7654'), aprobado);
  assert.equal(logAutorizadoPorCae([rechazado], '7654'), null);
});

test('ArcaLog createNextVoucher (homologación): mismo resultado', () => {
  const c = comprobanteDeRequestArca(
    {
      createNextVoucher: {
        PtoVta: 2,
        CbteTipo: 1,
        DocTipo: 80,
        DocNro: 30712345678,
        CbteFch: 20261001,
        ImpTotal: 121,
        ImpNeto: 100,
        MonId: 'PES',
        MonCotiz: 1,
        Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
      },
    },
    { CAE: '99', voucherNumber: 8 },
  );
  assert.equal(c?.cbteNro, 8);
  assert.equal(c?.alicuotas[0].iva, 21);
  assert.equal(caeDeRespuestaArca({ CAE: '99' }), '99');
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron');
