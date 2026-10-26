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
  ivaMontoDeTramos,
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

test('por tramo parcial: el neto es el viaje completo, no solo el tramo cargado', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1500 }];
  const tramos = [{ viajeId: 'v1', monto: 700, ivaPct: 22 }];
  const neto = importeNetoFactura(0, viajes, {
    facturarPorTramo: true,
    tramos,
  });
  assert.equal(neto, 1500);
  // 700 gravado 22% = 154; resto 800 con IVA cabecera 0% = 0 → total 1654
  assert.equal(importeTotalConIvaPorTramo(neto, tramos, 0), 1654);
  assert.equal(
    importeOperativoFactura(0, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 0,
    }),
    1654,
  );
});

test('ivaMonto guardado: el cobro usa el valor persistido, no recalcula', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1500 }];
  const tramos = [{ viajeId: 'v1', monto: 700, ivaPct: 22 }];
  assert.equal(
    importeOperativoFactura(1500, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 0,
      ivaMontoGuardado: 154,
    }),
    1654,
  );
});

test('por tramo con IVA mixto y resto no asignado: el sobrante no lleva IVA de cabecera', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1550 }];
  const tramos = [
    { viajeId: 'v1', monto: 920, ivaPct: 0 },
    { viajeId: 'v1', monto: 620, ivaPct: 22 },
  ];
  const iva = ivaMontoDeTramos(1550, tramos, 22, viajes);
  assert.equal(iva, 136.4);
  const total = importeTotalConIvaPorTramo(1550, tramos, 22, viajes);
  assert.equal(total, 1686.4);
  assert.equal(
    importeOperativoFactura(1550, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 22,
    }),
    1686.4,
  );

  const viajes1540 = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1540 }];
  const iva1540 = ivaMontoDeTramos(1540, tramos, 22, viajes1540);
  assert.equal(iva1540, 136.4);
  const total1540 = importeTotalConIvaPorTramo(1540, tramos, 22, viajes1540);
  assert.equal(total1540, 1676.4);
});

test('por tramo parcial con alícuota en cabecera: el sobrante del viaje no lleva IVA', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1500 }];
  const tramos = [{ viajeId: 'v1', monto: 700, ivaPct: 22 }];
  const iva = ivaMontoDeTramos(1500, tramos, 22, viajes);
  assert.equal(iva, 154);
  const total = importeTotalConIvaPorTramo(1500, tramos, 22, viajes);
  assert.equal(total, 1654);
});

test('factura mixta con viajes con tramo y viaje sin tramo: solo el viaje sin tramo toma IVA cabecera', () => {
  const viajes = [
    { id: 'v1', facturacionEstado: 'facturado', monto: 1550 },
    { id: 'v2', facturacionEstado: 'facturado', monto: 1000 },
  ];
  const tramos = [
    { viajeId: 'v1', monto: 920, ivaPct: 0 },
    { viajeId: 'v1', monto: 620, ivaPct: 22 },
  ];
  const iva = ivaMontoDeTramos(2550, tramos, 22, viajes);
  assert.equal(iva, 356.4);
  const total = importeTotalConIvaPorTramo(2550, tramos, 22, viajes);
  assert.equal(total, 2906.4);
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

// Vencimiento de facturas
test('el mismo día de vencimiento la factura sigue vigente (vencida = false)', () => {
  const { vencida, estado, cobrado } = computeEstadoFacturaLectura({
    viajes: [{ id: 'v1', facturacionEstado: 'facturado', monto: 1000 }],
    fechaVencimiento: new Date('2026-10-14T00:00:00.000Z'),
    hoyReferencia: '2026-10-14',
    importeGuardado: 1000,
    pagos: [],
    arcaEstado: null,
    tieneArca: false,
  });
  assert.equal(estado, 'facturado');
  assert.equal(cobrado, false);
  assert.equal(vencida, false, 'El 14/10 debe figurar como vigente, no vencida');
});

test('recién al día siguiente del vencimiento pasa a vencida (vencida = true)', () => {
  const { vencida } = computeEstadoFacturaLectura({
    viajes: [{ id: 'v1', facturacionEstado: 'facturado', monto: 1000 }],
    fechaVencimiento: new Date('2026-10-14T00:00:00.000Z'),
    hoyReferencia: '2026-10-15',
    importeGuardado: 1000,
    pagos: [],
    arcaEstado: null,
    tieneArca: false,
  });
  assert.equal(vencida, true, 'El 15/10 (día siguiente) debe figurar como vencida');
});

test('con fecha de vencimiento futura sigue vigente (vencida = false)', () => {
  const { vencida } = computeEstadoFacturaLectura({
    viajes: [{ id: 'v1', facturacionEstado: 'facturado', monto: 1000 }],
    fechaVencimiento: new Date('2026-10-20T00:00:00.000Z'),
    hoyReferencia: '2026-10-14',
    importeGuardado: 1000,
    pagos: [],
    arcaEstado: null,
    tieneArca: false,
  });
  assert.equal(vencida, false);
});

test('sin fecha de vencimiento no se marca como vencida', () => {
  const { vencida } = computeEstadoFacturaLectura({
    viajes: [{ id: 'v1', facturacionEstado: 'facturado', monto: 1000 }],
    fechaVencimiento: null,
    hoyReferencia: '2026-10-15',
    importeGuardado: 1000,
    pagos: [],
    arcaEstado: null,
    tieneArca: false,
  });
  assert.equal(vencida, false);
});

test('factura cobrada con vencimiento ayer no queda marcada como vencida', () => {
  const { vencida, cobrado } = computeEstadoFacturaLectura({
    viajes: [{ id: 'v1', facturacionEstado: 'cobrado', monto: 1000 }],
    fechaVencimiento: new Date('2026-10-14T00:00:00.000Z'),
    hoyReferencia: '2026-10-15',
    importeGuardado: 1000,
    pagos: [{ importe: 1000 }],
    arcaEstado: null,
    tieneArca: false,
  });
  assert.equal(cobrado, true);
  assert.equal(vencida, false);
});

console.log('factura-estado-lectura.spec.ts: OK');

