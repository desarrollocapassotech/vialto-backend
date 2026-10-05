/**
 * Pruebas del historial por unidad (MANT-02-T6).
 * Ejecutar: npm run test:mant-historial
 */
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { HistorialService } from './historial.service';
import { armarHistorial, type OrdenHistorial } from './historial.util';
import type { LecturaKm } from '../../core/odometro/odometro.types';
import type { OdometroService } from '../../core/odometro/odometro.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

let fallos = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

const d = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
const lec = (km: number, fecha: string, fuente = 'carga', createdAt = fecha, fuenteId = `${fuente}-${km}`): LecturaKm => ({
  km, fecha: d(fecha), fuente, fuenteId, createdAt: d(createdAt),
});
const ot = (id: string, fecha: string, createdAt: string, o: Partial<OrdenHistorial> = {}): OrdenHistorial => ({
  id, numero: 1, tipo: 'preventivo', estado: 'cerrada', km: null, costoTotal: 0, tareas: [], descripcion: null,
  fecha: d(fecha), createdAt: d(createdAt), taller: null, planes: [], cantidadItems: 0, ...o,
});
const resumen = (eventos: ReturnType<typeof armarHistorial>) =>
  eventos.map((e) => (e.tipo === 'orden' ? `OT:${e.orden.id}` : `${e.fuente}:${e.km}`));

(async () => {
  await test('mezcla OT y lecturas, más reciente primero', () => {
    const r = armarHistorial(
      [ot('o1', '2026-09-10', '2026-09-10T12:00:00Z', { km: 105_000 })],
      [lec(100_000, '2026-09-01T10:00:00Z'), lec(110_000, '2026-09-20T10:00:00Z'), lec(107_000, '2026-09-15', 'edicion')],
    );
    assert.deepEqual(resumen(r), ['carga:110000', 'edicion:107000', 'OT:o1', 'carga:100000']);
  });

  await test('mismo día: la OT cargada a la tarde va después (arriba) de la carga de la mañana', () => {
    const r = armarHistorial(
      [ot('o1', '2026-10-01', '2026-10-01T18:00:00Z')],
      [lec(100_000, '2026-10-01T08:00:00Z', 'carga', '2026-10-01T08:05:00Z')],
    );
    assert.deepEqual(resumen(r), ['OT:o1', 'carga:100000']);
  });

  await test('la lectura orden_trabajo del odómetro no se duplica con la OT', () => {
    const r = armarHistorial(
      [ot('o1', '2026-10-01', '2026-10-01T18:00:00Z', { km: 100_000 })],
      [lec(100_000, '2026-10-01', 'orden_trabajo', '2026-10-01T18:00:00Z', 'o1')],
    );
    assert.deepEqual(resumen(r), ['OT:o1']);
  });

  await test('sin OT ni lecturas → vacío', () => {
    assert.deepEqual(armarHistorial([], []), []);
  });

  // ── Service ──
  type Row = Record<string, any>;
  const T = 'org_A';
  function crearMock() {
    const llamadas: Row[] = [];
    const prisma = {
      vehiculo: {
        findFirst: async ({ where }: Row) => {
          llamadas.push({ where });
          return where.tenantId === T && where.id === 'v1'
            ? { id: 'v1', patente: 'AAA', tipo: 'tractor', marca: null, modelo: null, kmActual: 1 }
            : null;
        },
      },
      ordenTrabajo: {
        findMany: async ({ where }: Row) => {
          llamadas.push({ where });
          return [
            { ...ot('o1', '2026-09-10', '2026-09-10T12:00:00Z', { estado: 'anulada' }), planes: [], _count: { items: 2 } },
            {
              ...ot('o2', '2026-09-12', '2026-09-12T12:00:00Z'),
              planes: [{ vehiculoPlanId: 'vp1', vehiculoPlan: { plan: { nombre: 'Service' } } }],
              _count: { items: 0 },
            },
          ];
        },
      },
    };
    const odometro = {
      getLecturas: async (tenantId: string, vehiculoId: string, rango: Row) => {
        llamadas.push({ odometro: { tenantId, vehiculoId, rango } });
        return [lec(100_000, '2026-09-11T10:00:00Z')];
      },
      getUltimaLectura: async () => lec(100_000, '2026-09-11T10:00:00Z'),
    } as unknown as OdometroService;
    return { svc: new HistorialService(prisma as unknown as PrismaService, odometro), llamadas };
  }

  await test('service: unidad de otro tenant → 404', async () => {
    const { svc } = crearMock();
    await assert.rejects(svc.historial('org_B', 'v1'), NotFoundException);
  });

  await test('service: incluye anuladas, nombres de plan y cantidad de ítems; todo con tenantId', async () => {
    const { svc, llamadas } = crearMock();
    const h = await svc.historial(T, 'v1');
    assert.deepEqual(resumen(h.eventos), ['OT:o2', 'carga:100000', 'OT:o1']);
    const o2 = h.eventos[0];
    assert.ok(o2.tipo === 'orden' && o2.orden.planes[0].planNombre === 'Service' && o2.orden.cantidadItems === 0);
    const o1 = h.eventos[2];
    assert.ok(o1.tipo === 'orden' && o1.orden.estado === 'anulada' && o1.orden.cantidadItems === 2);
    assert.equal(h.odometro?.km, 100_000);
    assert.ok(llamadas.filter((l) => l.where).every((l) => l.where.tenantId === T));
  });

  await test('service: desde/hasta llegan a OT y lecturas (hasta = fin del día)', async () => {
    const { svc, llamadas } = crearMock();
    await svc.historial(T, 'v1', { desde: '2026-09-01', hasta: '2026-09-30' });
    const otWhere = llamadas.find((l) => l.where?.vehiculoId)?.where;
    const rango = llamadas.find((l) => l.odometro)?.odometro.rango;
    assert.equal(otWhere.fecha.gte.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(otWhere.fecha.lte.toISOString(), '2026-09-30T23:59:59.999Z');
    assert.equal(rango.hasta.toISOString(), '2026-09-30T23:59:59.999Z');
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
