/**
 * Agrupación de flete para el PDF contrato proveedor.
 * Ejecutar: npx ts-node --transpile-only src/modules/liquidaciones-arca/liquidacion-contrato.util.spec.ts
 */
import * as assert from 'assert';
import { buildLiquidacionContratoTotales } from './liquidacion-contrato.util';

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
  assert.equal(t.subtotal, 460);
  assert.equal(t.ivaPct, 21);
  assert.equal(t.iva, 96.6);
  assert.equal(t.totalFlete, 556.6);
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
  assert.equal(t.subtotal, 920);
  assert.equal(t.iva, 193.2);
  assert.equal(t.totalFlete, 1113.2);
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
  assert.equal(t.subtotal, 1470);
  assert.equal(t.iva, 308.7);
  assert.equal(t.totalFlete, 1778.7);
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
  assert.equal(t.totalFlete, 0);
});

console.log('liquidacion-contrato.util.spec.ts OK');
