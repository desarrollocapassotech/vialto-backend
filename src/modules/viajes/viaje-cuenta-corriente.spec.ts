/**
 * Pruebas de la cuenta corriente generada desde un viaje (VTO-426 / VTO-430 / VTO-431).
 * Ejecutar: npm run test:viaje-cuenta-corriente
 */
import * as assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import {
  sincronizarCuentaCorrienteViaje,
  type ViajeParaCuentaCorriente,
} from './viaje-cuenta-corriente';
import { ymdAr } from '../../shared/util/fecha-ar.util';

type Row = Record<string, unknown> & { id: string };

/** ¿`row` cumple `where`? Soporta igualdad, `{ not }`, `{ in }` y `null`. */
function cumple(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; in?: unknown[] };
      if ('not' in c) return v !== (c.not ?? null);
      if ('in' in c) return (c.in ?? []).includes(v);
      return true;
    }
    return v === (cond ?? null);
  });
}

/** Base en memoria con solo lo que usan el sync del viaje y la compensación. */
function fakeTx() {
  const movs: Row[] = [];
  const imps: Row[] = [];
  let seq = 0;
  const tabla = (rows: Row[], prefijo: string, defaults: Record<string, unknown> = {}) => ({
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => cumple(r, where)),
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => cumple(r, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const r = { ...defaults, ...data, id: `${prefijo}${++seq}`, createdAt: new Date() } as Row;
      rows.push(r);
      return r;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return r;
    },
    deleteMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const borrar = rows.filter((r) => cumple(r, where));
      for (const r of borrar) rows.splice(rows.indexOf(r), 1);
      return { count: borrar.length };
    },
    aggregate: async ({ where }: { where?: Record<string, unknown> }) => ({
      _sum: {
        importe: rows.filter((r) => cumple(r, where)).reduce((s, r) => s + Number(r.importe), 0),
      },
    }),
  });
  const tx = {
    movimientoCuentaCorriente: tabla(movs, 'mov', {
      clienteId: null,
      proveedorId: null,
      moneda: 'ARS',
      estadoDisponibilidad: 'pendiente',
      estadoImputacion: 'no_imputado',
      anulaMovimientoId: null,
    }),
    imputacionCuentaCorriente: tabla(imps, 'imp', { pagoFacturacionId: null }),
    pago: tabla([], 'pf'),
    viaje: { findFirst: async () => null, update: async () => null },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, movs, imps };
}

function viajeBase(over: Partial<ViajeParaCuentaCorriente> = {}): ViajeParaCuentaCorriente {
  return {
    id: 'v1',
    tenantId: 't1',
    clienteId: 'c1',
    transportistaId: null,
    numero: 'V-0001',
    numeroIdentificacionPersonalizado: null,
    etapa: 'pendiente',
    // 14/10 23:30 en Argentina = 15/10 02:30 UTC → el día del movimiento es el 14/10.
    createdAt: new Date('2026-10-15T02:30:00.000Z'),
    monto: 1000,
    monedaMonto: 'ARS',
    otrosGastos: [],
    precioTransportistaExterno: null,
    monedaPrecioTransportistaExterno: 'ARS',
    precioTransportistaIvaIncluidoPct: 0,
    pagosTransportista: [],
    facturaId: null,
    factura: null,
    liquidacionesViaje: [],
    ...over,
  };
}

const OPTS = { ivaTransportistaHabilitado: true };
const HOY = `${ymdAr()}T00:00:00.000Z`;
const vigentes = (movs: Row[]) =>
  movs.filter((m) => m.estadoDisponibilidad !== 'anulado' && m.tipo === 'cargo');
const saldo = (movs: Row[]) => vigentes(movs).reduce((s, m) => s + Number(m.importe), 0);

const tests: Array<[string, () => Promise<void>]> = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push([name, fn]);
}

test('al crear con cliente e importe: venta con fecha y concepto de creación', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  assert.equal(movs.length, 1);
  const m = movs[0];
  assert.equal(m.clienteId, 'c1');
  assert.equal(m.importe, 1000);
  assert.equal(m.concepto, 'Venta automática por creación del viaje V-0001');
  assert.equal((m.fecha as Date).toISOString(), '2026-10-14T00:00:00.000Z');
});

test('ID personalizado: el concepto usa el número visible', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ numeroIdentificacionPersonalizado: 'CTG-77' }), OPTS);
  assert.equal(movs[0].concepto, 'Venta automática por creación del viaje CTG-77');
});

test('transportista con precio: compra en la cuenta del proveedor (con IVA a sumar)', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ transportistaId: 'p1', precioTransportistaExterno: 1000, precioTransportistaIvaIncluidoPct: 21 }),
    OPTS,
  );
  const compra = movs.find((m) => m.proveedorId === 'p1')!;
  assert.equal(compra.importe, 1210);
  assert.equal(compra.concepto, 'Compra automática por creación del viaje V-0001');
});

test('sin importe no genera; al cargarlo después sí', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: null }), OPTS);
  assert.equal(movs.length, 0);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: 500 }), OPTS);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].importe, 500);
});

test('cambio de importe u otros gastos sin imputaciones: actualiza importe, no fecha ni concepto', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ monto: 1500, otrosGastos: [{ monto: 200, moneda: 'ARS' }, { monto: 50, moneda: 'USD' }] }),
    OPTS,
  );
  assert.equal(movs.length, 1);
  assert.equal(movs[0].importe, 1700);
  assert.equal((movs[0].fecha as Date).toISOString(), '2026-10-14T00:00:00.000Z');
});

test('con imputaciones el movimiento queda congelado', async () => {
  const { tx, movs, imps } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  imps.push({ id: 'i1', tenantId: 't1', cargoId: movs[0].id, pagoId: 'cobro', importe: 400 });
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: 3000 }), OPTS);
  assert.equal(movs[0].importe, 1000);
});

test('finalizar no duplica ni cambia fecha o concepto', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ etapa: 'finalizado' }), OPTS);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].concepto, 'Venta automática por creación del viaje V-0001');
});

test('también en empresas con Facturación el viaje genera la venta (VTO-430)', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  assert.equal(movs.filter((m) => m.clienteId).length, 1);
});

test('con factura vigente el lado cliente no se toca; con la factura anulada se regenera', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ facturaId: 'f1', factura: { arcaEstado: 'autorizado' }, monto: 9999 }),
    OPTS,
  );
  assert.equal(movs.length, 0);
  // Simula la fila ya transformada en la factura y después compensada.
  movs.push({ id: 'fac', tenantId: 't1', clienteId: 'c1', proveedorId: null, contraparteId: 'c1', viajeId: 'v1', tipo: 'cargo', origen: 'factura', importe: 1210, estadoDisponibilidad: 'anulado' });
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ facturaId: 'f1', factura: { arcaEstado: 'anulado' } }),
    OPTS,
  );
  const nuevo = movs.find((m) => m.origen === 'viaje')!;
  assert.equal(nuevo.importe, 1000);
  assert.equal((nuevo.fecha as Date).toISOString(), HOY);
});

test('con liquidación vigente del transportista el lado proveedor no se toca', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({
      transportistaId: 'p1',
      precioTransportistaExterno: 800,
      liquidacionesViaje: [{ liquidacion: { estado: 'borrador', transportistaId: 'p1' } }],
    }),
    OPTS,
  );
  assert.equal(movs.filter((m) => m.proveedorId).length, 0);
});

test('cancelar: negativo que compensa, original intacto y anulado, cobros a cuenta; reabrir crea uno nuevo de hoy', async () => {
  const { tx, movs, imps } = fakeTx();
  const v = viajeBase({ transportistaId: 'p1', precioTransportistaExterno: 800 });
  await sincronizarCuentaCorrienteViaje(tx, v, OPTS);
  const saldoAntes = 0;
  const venta = movs.find((m) => m.clienteId)!;
  movs.push({ id: 'cobro', tenantId: 't1', tipo: 'pago', importe: 300, estadoImputacion: 'imputado_parcial' });
  imps.push({ id: 'i1', tenantId: 't1', cargoId: venta.id, pagoId: 'cobro', importe: 300 });

  await sincronizarCuentaCorrienteViaje(tx, { ...v, etapa: 'cancelado' }, OPTS);
  assert.equal(venta.estadoDisponibilidad, 'anulado');
  assert.equal(venta.importe, 1000);
  const negVenta = movs.find((m) => m.anulaMovimientoId === venta.id)!;
  assert.equal(negVenta.importe, -1000);
  assert.equal(negVenta.concepto, 'Anulación por cancelación del viaje V-0001');
  assert.equal(movs.filter((m) => m.origen === 'anulacion').length, 2);
  assert.equal(imps.length, 0);
  assert.equal(movs.find((m) => m.id === 'cobro')!.estadoImputacion, 'no_imputado');
  assert.equal(saldo(movs), saldoAntes);

  // Cancelar otra vez no genera un segundo negativo.
  await sincronizarCuentaCorrienteViaje(tx, { ...v, etapa: 'cancelado' }, OPTS);
  assert.equal(movs.filter((m) => m.origen === 'anulacion').length, 2);

  await sincronizarCuentaCorrienteViaje(tx, { ...v, etapa: 'en_curso' }, OPTS);
  const nuevaVenta = vigentes(movs).find((m) => m.clienteId)!;
  assert.notEqual(nuevaVenta.id, venta.id);
  assert.equal((nuevaVenta.fecha as Date).toISOString(), HOY);
});

test('cambio de cliente: compensa el del anterior y crea el del nuevo', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), OPTS);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ clienteId: 'c2' }), OPTS);
  const c1 = movs.find((m) => m.clienteId === 'c1' && m.origen === 'viaje')!;
  assert.equal(c1.estadoDisponibilidad, 'anulado');
  assert.ok(movs.find((m) => m.anulaMovimientoId === c1.id));
  assert.equal(vigentes(movs).find((m) => m.clienteId === 'c2')!.importe, 1000);
});

test('movimiento legado (al finalizar) no cambia de fecha ni concepto', async () => {
  const { tx, movs } = fakeTx();
  movs.push({
    id: 'legado', tenantId: 't1', clienteId: 'c1', proveedorId: null, contraparteId: 'c1', viajeId: 'v1',
    tipo: 'cargo', origen: 'viaje', concepto: 'Venta automática por viaje V-0001', importe: 1000,
    moneda: 'ARS', fecha: new Date('2026-09-30T15:00:00.000Z'), estadoDisponibilidad: 'pendiente',
  });
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ etapa: 'finalizado' }), OPTS);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].concepto, 'Venta automática por viaje V-0001');
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      console.error(`✗ ${name}`);
      throw e;
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
