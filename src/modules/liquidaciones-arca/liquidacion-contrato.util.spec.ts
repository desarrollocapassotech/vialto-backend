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
  resolverIdsPersonalizadosViaje,
  resolverTenantIdConfig,
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

test('resolverTenantIdConfig aplica defaults cuando tenant es null o vacío', () => {
  const def = resolverTenantIdConfig(null);
  assert.equal(def.idPropio1Habilitado, true);
  assert.equal(def.idPropio1Label, 'ID propio');
  assert.equal(def.idPropio2Habilitado, false);
  assert.equal(def.idPropio2Label, 'ID Propio 2');

  const vacio = resolverTenantIdConfig({});
  assert.equal(vacio.idPropio1Habilitado, true);
  assert.equal(vacio.idPropio1Label, 'ID propio');
  assert.equal(vacio.idPropio2Habilitado, false);
  assert.equal(vacio.idPropio2Label, 'ID Propio 2');
});

test('resolverTenantIdConfig respeta labels personalizados y flags de tenant', () => {
  const lsf = resolverTenantIdConfig({
    idPropio1Habilitado: true,
    labelIdentificacionPersonalizadaViajes: '  MIC / REMITO  ',
    idPropio2Habilitado: true,
    idPropio2Label: '  CRT / OP  ',
  });
  assert.equal(lsf.idPropio1Habilitado, true);
  assert.equal(lsf.idPropio1Label, 'MIC / REMITO');
  assert.equal(lsf.idPropio2Habilitado, true);
  assert.equal(lsf.idPropio2Label, 'CRT / OP');
});

test('resolverIdsPersonalizadosViaje incluye ambos IDs con sus labels si tenant tiene ambos activos', () => {
  const config = {
    idPropio1Habilitado: true,
    idPropio1Label: 'MIC / REMITO',
    idPropio2Habilitado: true,
    idPropio2Label: 'CRT / OP',
  };
  const viaje = {
    numeroIdentificacionPersonalizado: 'MR-10293',
    idPropio2: 'CO-4091',
  };
  const ids = resolverIdsPersonalizadosViaje(viaje, config);
  assert.equal(ids.length, 2);
  assert.equal(ids[0].label, 'MIC / REMITO');
  assert.equal(ids[0].valor, 'MR-10293');
  assert.equal(ids[1].label, 'CRT / OP');
  assert.equal(ids[1].valor, 'CO-4091');
});

test('resolverIdsPersonalizadosViaje incluye solo ID 1 si ID 2 está deshabilitado', () => {
  const config = {
    idPropio1Habilitado: true,
    idPropio1Label: 'CTG',
    idPropio2Habilitado: false,
    idPropio2Label: 'ID Propio 2',
  };
  const viaje = {
    numeroIdentificacionPersonalizado: '10130658234',
    idPropio2: 'CP-999',
  };
  const ids = resolverIdsPersonalizadosViaje(viaje, config);
  assert.equal(ids.length, 1);
  assert.equal(ids[0].label, 'CTG');
  assert.equal(ids[0].valor, '10130658234');
});

test('resolverIdsPersonalizadosViaje devuelve lista vacía si ambos IDs están deshabilitados', () => {
  const config = {
    idPropio1Habilitado: false,
    idPropio1Label: 'ID propio',
    idPropio2Habilitado: false,
    idPropio2Label: 'ID Propio 2',
  };
  const viaje = {
    numeroIdentificacionPersonalizado: '123',
    idPropio2: '456',
  };
  const ids = resolverIdsPersonalizadosViaje(viaje, config);
  assert.equal(ids.length, 0);
});

test('resolverIdsPersonalizadosViaje aplica trim y deja null si el viaje no tiene dato cargado', () => {
  const config = {
    idPropio1Habilitado: true,
    idPropio1Label: 'MIC / REMITO',
    idPropio2Habilitado: true,
    idPropio2Label: 'CRT / OP',
  };
  const viajeEspaciado = {
    numeroIdentificacionPersonalizado: '   VAL-1   ',
    idPropio2: '   VAL-2   ',
  };
  const idsEspaciado = resolverIdsPersonalizadosViaje(viajeEspaciado, config);
  assert.equal(idsEspaciado[0].valor, 'VAL-1');
  assert.equal(idsEspaciado[1].valor, 'VAL-2');

  const viajeSinDatos = {
    numeroIdentificacionPersonalizado: '   ',
    idPropio2: null,
  };
  const idsSinDatos = resolverIdsPersonalizadosViaje(viajeSinDatos, config);
  assert.equal(idsSinDatos.length, 2);
  assert.equal(idsSinDatos[0].label, 'MIC / REMITO');
  assert.equal(idsSinDatos[0].valor, null);
  assert.equal(idsSinDatos[1].label, 'CRT / OP');
  assert.equal(idsSinDatos[1].valor, null);
});

test('buildLiquidacionContratoTotales descuenta comision de la base gravada e IVA sobre neto', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      {
        ...base,
        toneladas: 10,
        precioPorTn: 100,
        subtotal: 1000,
        adelanto: 100,
      },
    ],
    comision: 50,
    comisionPct: 5,
  });
  // subtotal = 1000, comision = 50 -> netoGravado = 950
  assert.equal(t.subtotal, 1000);
  assert.equal(t.comision, 50);
  assert.equal(t.comisionPct, 5);
  assert.equal(t.netoGravado, 950);
  // IVA 21% sobre 950 = 199.50
  assert.equal(t.iva, 199.5);
  // Total a pagar = 950 + 199.50 - 100 (adelanto) = 1049.50
  assert.equal(t.totalAPagar, 1049.5);
});

test('buildLiquidacionContratoTotales no descuenta ni aplica comision cuando es 0 o nula', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      {
        ...base,
        toneladas: 10,
        precioPorTn: 100,
        subtotal: 1000,
        adelanto: 100,
      },
    ],
    comision: 0,
    comisionPct: 0,
  });
  assert.equal(t.comision, 0);
  assert.equal(t.comisionPct, 0);
  assert.equal(t.netoGravado, 1000);
  assert.equal(t.iva, 210);
  assert.equal(t.totalAPagar, 1110);
});

test('buildLiquidacionContratoTotales con conceptos y datos persistidos coincide con detalle de liquidacion', () => {
  const t = buildLiquidacionContratoTotales({
    ivaPct: 21,
    viajes: [
      {
        ...base,
        toneladas: 33.06,
        precioPorTn: 60000,
        subtotal: 1983600,
        adelanto: 0,
      },
    ],
    comision: 158688,
    comisionPct: 8,
    conceptosLineas: [
      {
        nombreSnapshot: 'Gastos administrativos',
        signo: 'contra',
        monto: 3500,
        ivaPct: 21,
      },
    ],
    ivaPersistido: 382496.52,
    liquidoPersistido: 2203908.52,
  });
  assert.equal(t.subtotal, 1983600);
  assert.equal(t.comision, 158688);
  assert.equal(t.conceptos.length, 1);
  assert.equal(t.conceptos[0].label, 'Gastos administrativos (IVA 21%)');
  assert.equal(t.conceptos[0].monto, 3500);
  assert.equal(t.netoGravado, 1821412);
  assert.equal(t.iva, 382496.52);
  assert.equal(t.totalAPagar, 2203908.52);
});

test('liquidación emitida con comisión descuenta la comisión del subtotal y respeta los valores guardados', () => {
  const t = buildLiquidacionContratoTotales({
    viajes: [
      {
        ...base,
        toneladas: 10,
        precioPorTn: 50,
        subtotal: 500,
      },
    ],
    liq: {
      bruto: 500,
      comisionPct: 8,
      comision: 40,
      ivaPct: 21,
      gastosAdminIva: 96.6,
      liquido: 556.6,
      moneda: 'ARS',
      cantViajes: 1,
    },
  });
  assert.equal(t.bruto, 500);
  assert.equal(t.comisionPct, 8);
  assert.equal(t.comision, 40);
  assert.equal(t.subtotal, 500);
  assert.equal(t.netoGravado, 460);
  assert.equal(t.ivaPct, 21);
  assert.equal(t.iva, 96.6);
  assert.equal(t.totalFlete, 556.6);
  assert.equal(t.totalAPagar, 556.6);
  assert.equal(t.moneda, 'ARS');
});

test('liquidación emitida con conceptos adicionales mantiene los importes netos y totales persistidos', () => {
  const t = buildLiquidacionContratoTotales({
    viajes: [
      {
        ...base,
        toneladas: 20,
        precioPorTn: 50,
        subtotal: 1000,
      },
    ],
    liq: {
      bruto: 1000,
      comisionPct: 10,
      comision: 100,
      ivaPct: 21,
      gastosAdminIva: 193.2,
      liquido: 1113.2,
      moneda: 'ARS',
      cantViajes: 1,
      conceptosLineas: [
        {
          nombreSnapshot: 'Seguro de carga',
          signo: 'favor',
          monto: 50,
        },
        {
          nombreSnapshot: 'Peaje anticipado',
          signo: 'contra',
          monto: 30,
        },
      ],
    },
  });
  assert.equal(t.bruto, 1000);
  assert.equal(t.comision, 100);
  assert.equal(t.conceptosLineas.length, 2);
  assert.equal(t.subtotal, 1000);
  assert.equal(t.netoGravado, 920);
  assert.equal(t.iva, 193.2);
  assert.equal(t.totalFlete, 1113.2);
  assert.equal(t.totalAPagar, 1113.2);
});

test('conceptos aplicados a todos los viajes multiplican el importe por la cantidad de viajes', () => {
  const t = buildLiquidacionContratoTotales({
    viajes: [
      { ...base, numero: '1', toneladas: 10, precioPorTn: 50, subtotal: 500 },
      { ...base, numero: '2', toneladas: 10, precioPorTn: 50, subtotal: 500 },
      { ...base, numero: '3', toneladas: 10, precioPorTn: 50, subtotal: 500 },
    ],
    liq: {
      bruto: 1500,
      comisionPct: 0,
      comision: 0,
      ivaPct: 21,
      gastosAdminIva: 308.7,
      liquido: 1778.7,
      moneda: 'ARS',
      cantViajes: 3,
      conceptosLineas: [
        {
          nombreSnapshot: 'Seguro por viaje',
          signo: 'contra',
          monto: 10,
          modoAplicacion: 'TODOS_LOS_VIAJES',
        },
      ],
    },
  });
  assert.equal(t.cantViajes, 3);
  assert.equal(t.subtotal, 1500);
  assert.equal(t.netoGravado, 1470);
  assert.equal(t.iva, 308.7);
  assert.equal(t.totalFlete, 1778.7);
  assert.equal(t.totalAPagar, 1778.7);
});

test('liquidación sin viajes maneja grupos vacíos sin errores', () => {
  const t = buildLiquidacionContratoTotales({
    viajes: [],
    liq: {
      bruto: 0,
      comisionPct: 0,
      comision: 0,
      ivaPct: 21,
      gastosAdminIva: 0,
      liquido: 0,
      moneda: 'ARS',
      cantViajes: 0,
    },
  });
  assert.equal(t.cantViajes, 0);
  assert.equal(t.grupos.length, 0);
  assert.equal(t.subtotal, 0);
  assert.equal(t.netoGravado, 0);
  assert.equal(t.totalFlete, 0);
  assert.equal(t.totalAPagar, 0);
});

console.log('liquidacion-contrato.util.spec.ts OK');
