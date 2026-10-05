/**
 * Pruebas de la edición de km en core (MANT-01-T2), con Prisma mockeado en memoria.
 * Ejecutar: npm run test:vehiculos-km
 */
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { VehiculosService } from './vehiculos.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

type Vehiculo = { id: string; tenantId: string; kmActual: number; patente: string };
type Edicion = Record<string, unknown>;

function crearPrisma(vehiculos: Vehiculo[]) {
  const ediciones: Edicion[] = [];
  const match = (v: Vehiculo, where: { id: string; tenantId: string }) =>
    v.id === where.id && v.tenantId === where.tenantId;
  const client = {
    vehiculo: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        vehiculos.find((v) => match(v, where)) ?? null,
      findFirstOrThrow: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const v = vehiculos.find((x) => match(x, where));
        if (!v) throw new Error('not found');
        return v;
      },
      updateMany: async ({ where, data }: { where: { id: string; tenantId: string }; data: Partial<Vehiculo> }) => {
        const hits = vehiculos.filter((v) => match(v, where));
        for (const v of hits) {
          for (const [k, val] of Object.entries(data)) if (val !== undefined) (v as Record<string, unknown>)[k] = val;
        }
        return { count: hits.length };
      },
    },
    vehiculoKmEdicion: {
      create: async ({ data }: { data: Edicion }) => {
        const row = { id: `e${ediciones.length + 1}`, ...data };
        ediciones.push(row);
        return row;
      },
      findMany: async () => ediciones,
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
  };
  return { prisma: client as unknown as PrismaService, ediciones };
}

let fallos = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

const base = (): Vehiculo[] => [
  { id: 'v1', tenantId: 'org_A', kmActual: 100_000, patente: 'AA123BB' },
  { id: 'v2', tenantId: 'org_B', kmActual: 50_000, patente: 'CC456DD' },
];

(async () => {
  await test('editarKm registra la edición con fecha de hoy 00:00 UTC y km anterior', async () => {
    const vs = base();
    const { prisma, ediciones } = crearPrisma(vs);
    const ed = (await new VehiculosService(prisma).editarKm('org_A', 'v1', 105_000, 'user_1')) as Edicion;
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    assert.equal(ediciones.length, 1);
    assert.equal(ed.kmAnterior, 100_000);
    assert.equal(ed.kmNuevo, 105_000);
    assert.equal(ed.createdBy, 'user_1');
    assert.equal(ed.tenantId, 'org_A');
    assert.equal((ed.fecha as Date).toISOString(), hoy.toISOString());
    assert.equal(vs[0].kmActual, 105_000);
  });

  await test('editarKm con el mismo km igual deja registro (comportamiento histórico)', async () => {
    const { prisma, ediciones } = crearPrisma(base());
    await new VehiculosService(prisma).editarKm('org_A', 'v1', 100_000, 'user_1');
    assert.equal(ediciones.length, 1);
  });

  await test('editarKm sobre un vehículo de otro tenant → 404 y no escribe nada', async () => {
    const vs = base();
    const { prisma, ediciones } = crearPrisma(vs);
    await assert.rejects(new VehiculosService(prisma).editarKm('org_A', 'v2', 1, 'user_1'), NotFoundException);
    assert.equal(ediciones.length, 0);
    assert.equal(vs[1].kmActual, 50_000);
  });

  await test('update con km distinto registra la edición y actualiza el vehículo', async () => {
    const vs = base();
    const { prisma, ediciones } = crearPrisma(vs);
    const r = await new VehiculosService(prisma).update('v1', 'org_A', { kmActual: 110_000 }, 'user_2');
    assert.equal(ediciones.length, 1);
    assert.equal(ediciones[0].kmAnterior, 100_000);
    assert.equal(ediciones[0].createdBy, 'user_2');
    assert.equal(r.kmActual, 110_000);
  });

  await test('update con el mismo km no registra edición', async () => {
    const { prisma, ediciones } = crearPrisma(base());
    await new VehiculosService(prisma).update('v1', 'org_A', { kmActual: 100_000, marca: 'Scania' }, 'user_2');
    assert.equal(ediciones.length, 0);
  });

  await test('update sin km no registra edición', async () => {
    const vs = base();
    const { prisma, ediciones } = crearPrisma(vs);
    await new VehiculosService(prisma).update('v1', 'org_A', { marca: 'Iveco' }, 'user_2');
    assert.equal(ediciones.length, 0);
    assert.equal(vs[0].kmActual, 100_000);
  });

  await test('update sobre un vehículo de otro tenant → 404', async () => {
    const { prisma, ediciones } = crearPrisma(base());
    await assert.rejects(
      new VehiculosService(prisma).update('v2', 'org_A', { kmActual: 1 }, 'user_2'),
      NotFoundException,
    );
    assert.equal(ediciones.length, 0);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
