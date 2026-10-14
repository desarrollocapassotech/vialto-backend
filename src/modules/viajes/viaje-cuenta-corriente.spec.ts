/**
 * Pruebas de la cuenta corriente generada desde un viaje (nace al crear el viaje).
 * Ejecutar: npm run test:viaje-cuenta-corriente
 */
import * as assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import {
  sincronizarCuentaCorrienteViaje,
  type ViajeParaCuentaCorriente,
} from './viaje-cuenta-corriente';

type Mov = {
  id: string;
  tenantId: string;
  clienteId: string | null;
  proveedorId: string | null;
  contraparteId: string;
  viajeId: string | null;
  tipo: string;
  origen: string;
  concepto: string;
  importe: number;
  moneda: string;
  fecha: Date;
  referencia: string | null;
  estadoDisponibilidad: string;
};
type Imp = { tenantId: string; cargoId: string; importe: number };

/** Base en memoria con solo lo que usa `sincronizarCuentaCorrienteViaje`. */
function fakeTx() {
  const movs: Mov[] = [];
  const imps: Imp[] = [];
  let seq = 0;
  const tx = {
    movimientoCuentaCorriente: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        movs.filter(
          (m) =>
            m.tenantId === where.tenantId &&
            m.viajeId === where.viajeId &&
            m.tipo === where.tipo &&
            m.origen === where.origen &&
            (!('clienteId' in where) || m.clienteId != null) &&
            (!('proveedorId' in where) || m.proveedorId != null),
        ),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Mov> }) => {
        const m = movs.find((x) => x.id === where.id)!;
        Object.assign(m, data);
        return m;
      },
      create: async ({ data }: { data: Partial<Mov> }) => {
        const m = {
          clienteId: null,
          proveedorId: null,
          moneda: 'ARS',
          estadoDisponibilidad: 'pendiente',
          ...data,
          id: `mov${++seq}`,
        } as Mov;
        movs.push(m);
        return m;
      },
    },
    imputacionCuentaCorriente: {
      aggregate: async ({ where }: { where: { tenantId: string; cargoId: string } }) => ({
        _sum: {
          importe: imps
            .filter((i) => i.tenantId === where.tenantId && i.cargoId === where.cargoId)
            .reduce((s, i) => s + i.importe, 0),
        },
      }),
    },
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
    liquidacionesViaje: [],
    ...over,
  };
}

const SIN_FACT = { ivaTransportistaHabilitado: true, conFacturacion: false };
const CON_FACT = { ivaTransportistaHabilitado: true, conFacturacion: true };

const tests: Array<[string, () => Promise<void>]> = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push([name, fn]);
}

test('al crear con cliente e importe: venta con fecha y concepto de creación', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), SIN_FACT);
  assert.equal(movs.length, 1);
  const m = movs[0];
  assert.equal(m.clienteId, 'c1');
  assert.equal(m.importe, 1000);
  assert.equal(m.concepto, 'Venta automática por creación del viaje V-0001');
  assert.equal(m.fecha.toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(m.estadoDisponibilidad, 'pendiente');
});

test('ID personalizado: el concepto usa el número visible', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ numeroIdentificacionPersonalizado: 'CTG-77' }),
    SIN_FACT,
  );
  assert.equal(movs[0].concepto, 'Venta automática por creación del viaje CTG-77');
  assert.equal(movs[0].referencia, 'CTG-77');
});

test('transportista con precio: compra en la cuenta del proveedor (con IVA a sumar)', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({
      transportistaId: 'p1',
      precioTransportistaExterno: 1000,
      precioTransportistaIvaIncluidoPct: 21,
    }),
    SIN_FACT,
  );
  const compra = movs.find((m) => m.proveedorId === 'p1')!;
  assert.equal(compra.importe, 1210);
  assert.equal(compra.concepto, 'Compra automática por creación del viaje V-0001');
});

test('sin importe no genera; al cargarlo después sí', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: null }), SIN_FACT);
  assert.equal(movs.length, 0);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: 500 }), SIN_FACT);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].importe, 500);
});

test('cambio de importe u otros gastos sin imputaciones: actualiza importe, no fecha ni concepto', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), SIN_FACT);
  const fecha = movs[0].fecha.toISOString();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({
      monto: 1500,
      numeroIdentificacionPersonalizado: 'OTRO',
      otrosGastos: [{ monto: 200, moneda: 'ARS' }, { monto: 50, moneda: 'USD' }],
    }),
    SIN_FACT,
  );
  assert.equal(movs.length, 1);
  assert.equal(movs[0].importe, 1700);
  assert.equal(movs[0].fecha.toISOString(), fecha);
  assert.equal(movs[0].concepto, 'Venta automática por creación del viaje V-0001');
});

test('con imputaciones el cargo queda congelado', async () => {
  const { tx, movs, imps } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), SIN_FACT);
  imps.push({ tenantId: 't1', cargoId: movs[0].id, importe: 400 });
  movs[0].estadoDisponibilidad = 'parcial';
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ monto: 3000 }), SIN_FACT);
  assert.equal(movs[0].importe, 1000);
  assert.equal(movs[0].estadoDisponibilidad, 'parcial');
});

test('finalizar no duplica ni cambia fecha o concepto', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), SIN_FACT);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ etapa: 'finalizado' }), SIN_FACT);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].concepto, 'Venta automática por creación del viaje V-0001');
  assert.equal(movs[0].fecha.toISOString(), '2026-10-14T00:00:00.000Z');
});

test('cancelar anula sin imputaciones; con imputaciones no se toca; reabrir reactiva', async () => {
  const { tx, movs, imps } = fakeTx();
  const v = viajeBase({ transportistaId: 'p1', precioTransportistaExterno: 800 });
  await sincronizarCuentaCorrienteViaje(tx, v, SIN_FACT);
  const venta = movs.find((m) => m.clienteId)!;
  const compra = movs.find((m) => m.proveedorId)!;
  imps.push({ tenantId: 't1', cargoId: compra.id, importe: 100 });

  await sincronizarCuentaCorrienteViaje(tx, { ...v, etapa: 'cancelado' }, SIN_FACT);
  assert.equal(venta.estadoDisponibilidad, 'anulado');
  assert.equal(compra.estadoDisponibilidad, 'pendiente');

  await sincronizarCuentaCorrienteViaje(tx, { ...v, etapa: 'en_curso' }, SIN_FACT);
  assert.equal(venta.estadoDisponibilidad, 'pendiente');
  assert.equal(movs.length, 2);
});

test('con Facturación el lado cliente no se genera desde el viaje; el proveedor sí', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(
    tx,
    viajeBase({ transportistaId: 'p1', precioTransportistaExterno: 800 }),
    CON_FACT,
  );
  assert.equal(movs.length, 1);
  assert.equal(movs[0].proveedorId, 'p1');
});

test('cambio de cliente: anula el cargo del anterior (sin imputaciones) y crea el del nuevo', async () => {
  const { tx, movs } = fakeTx();
  await sincronizarCuentaCorrienteViaje(tx, viajeBase(), SIN_FACT);
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ clienteId: 'c2' }), SIN_FACT);
  assert.equal(movs.length, 2);
  assert.equal(movs.find((m) => m.clienteId === 'c1')!.estadoDisponibilidad, 'anulado');
  assert.equal(movs.find((m) => m.clienteId === 'c2')!.estadoDisponibilidad, 'pendiente');
});

test('movimiento legado (al finalizar) no cambia de fecha ni concepto', async () => {
  const { tx, movs } = fakeTx();
  movs.push({
    id: 'legado',
    tenantId: 't1',
    clienteId: 'c1',
    proveedorId: null,
    contraparteId: 'c1',
    viajeId: 'v1',
    tipo: 'cargo',
    origen: 'viaje',
    concepto: 'Venta automática por viaje V-0001',
    importe: 1000,
    moneda: 'ARS',
    fecha: new Date('2026-09-30T15:00:00.000Z'),
    referencia: 'V-0001',
    estadoDisponibilidad: 'pendiente',
  });
  await sincronizarCuentaCorrienteViaje(tx, viajeBase({ etapa: 'finalizado' }), SIN_FACT);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].concepto, 'Venta automática por viaje V-0001');
  assert.equal(movs[0].fecha.toISOString(), '2026-09-30T15:00:00.000Z');
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
})().catch(() => process.exit(1));
