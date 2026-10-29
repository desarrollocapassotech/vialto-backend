/**
 * Cobro de facturas: por tramo el IVA entra al saldo; ARCA y sin tramo no cambian.
 * Ejecutar: npx ts-node --transpile-only src/shared/util/factura-estado-lectura.spec.ts
 */
import * as assert from 'assert';
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

test('sin tramos y sin IVA: suma de viajes (o importe guardado si no hay viajes)', () => {
  assert.equal(importeOperativoFactura(0, viajes3100, { ivaPctCabecera: 0 }), 3100);
  assert.equal(importeOperativoFactura(99, [], { ivaPctCabecera: 0 }), 99);
});

test('sin tramos con IVA (ej. 21%): cobro = neto + IVA (3100 + 651 = 3751)', () => {
  assert.equal(importeOperativoFactura(0, viajes3100, { ivaPctCabecera: 21 }), 3751);
  assert.equal(importeOperativoFactura(0, viajes3100, { tieneArca: true, ivaPctCabecera: 21 }), 3751);
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

test('tenant ARCA: por tramo también incluye el IVA en el total a cobrar', () => {
  assert.equal(
    importeOperativoFactura(0, viajes3100, {
      tieneArca: true,
      facturarPorTramo: true,
      tramos: tramosUru,
      ivaPctCabecera: 0,
    }),
    3254,
  );
});

test('factura manual con ARCA: sin emitir se lee como facturada, no como borrador', () => {
  const base = {
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [],
    arcaEstado: null,
    tieneArca: true,
  };
  assert.equal(computeEstadoFacturaLectura(base).estado, 'borrador');
  assert.equal(computeEstadoFacturaLectura({ ...base, manual: true }).estado, 'facturado');
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

test('por tramo: la suma de tramos pisa el monto del viaje en el neto', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1500 }];
  const tramos = [{ viajeId: 'v1', monto: 700, ivaPct: 22 }];
  const neto = importeNetoFactura(0, viajes, {
    facturarPorTramo: true,
    tramos,
  });
  assert.equal(neto, 700);
  // 700 gravado 22% = 154 → total 854
  assert.equal(importeTotalConIvaPorTramo(neto, tramos, 0), 854);
  assert.equal(
    importeOperativoFactura(0, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 0,
    }),
    854,
  );
});

test('ivaMonto guardado: el cobro usa el valor persistido, no recalcula', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 700 }];
  const tramos = [{ viajeId: 'v1', monto: 700, ivaPct: 22 }];
  assert.equal(
    importeOperativoFactura(700, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 0,
      ivaMontoGuardado: 154,
    }),
    854,
  );
});

test('por tramo con IVA mixto: suma de tramos define el neto y total con IVA (ej. 920 exento + 620 gravado)', () => {
  const viajes = [{ id: 'v1', facturacionEstado: 'facturado', monto: 1550 }];
  const tramos = [
    { viajeId: 'v1', monto: 920, ivaPct: 0 },
    { viajeId: 'v1', monto: 620, ivaPct: 22 },
  ];
  const neto = importeNetoFactura(0, viajes, {
    facturarPorTramo: true,
    tramos,
  });
  assert.equal(neto, 1540);
  const iva = ivaMontoDeTramos(neto, tramos, 22, viajes);
  assert.equal(iva, 136.4);
  const total = importeTotalConIvaPorTramo(neto, tramos, 22, viajes);
  assert.equal(total, 1676.4);
  assert.equal(
    importeOperativoFactura(0, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 22,
    }),
    1676.4,
  );
});

test('factura mixta con viajes con tramo y viaje sin tramo: suma de tramos para el primero + neto del segundo', () => {
  const viajes = [
    { id: 'v1', facturacionEstado: 'facturado', monto: 1550 },
    { id: 'v2', facturacionEstado: 'facturado', monto: 1000 },
  ];
  const tramos = [
    { viajeId: 'v1', monto: 920, ivaPct: 0 },
    { viajeId: 'v1', monto: 620, ivaPct: 22 },
  ];
  const neto = importeNetoFactura(0, viajes, {
    facturarPorTramo: true,
    tramos,
  });
  // v1 toma tramos (1540), v2 sin tramos toma su monto (1000) → neto = 2540
  assert.equal(neto, 2540);
  const iva = ivaMontoDeTramos(neto, tramos, 22, viajes);
  // v1 IVA tramos: 136.4, v2 IVA cabecera: 220 → IVA total = 356.4
  assert.equal(iva, 356.4);
  const total = importeTotalConIvaPorTramo(neto, tramos, 22, viajes);
  assert.equal(total, 2896.4);
  assert.equal(
    importeOperativoFactura(0, viajes, {
      facturarPorTramo: true,
      tramos,
      ivaPctCabecera: 22,
    }),
    2896.4,
  );
});

test('sin tramo con IVA: pagar solo el neto no la deja cobrada', () => {
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
  assert.equal(cobrado, false);
});

test('sin tramo con IVA: cobrada al cubrir el total con IVA', () => {
  const { cobrado } = computeEstadoFacturaLectura({
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [{ importe: 3751 }],
    arcaEstado: null,
    tieneArca: false,
    facturarPorTramo: false,
    ivaPctCabecera: 21,
  });
  assert.equal(cobrado, true);
});

test('sin tramo exenta (0% IVA): pagar el neto la deja cobrada', () => {
  const { cobrado } = computeEstadoFacturaLectura({
    viajes: viajes3100,
    fechaVencimiento: null,
    importeGuardado: 3100,
    pagos: [{ importe: 3100 }],
    arcaEstado: null,
    tieneArca: false,
    facturarPorTramo: false,
    ivaPctCabecera: 0,
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

