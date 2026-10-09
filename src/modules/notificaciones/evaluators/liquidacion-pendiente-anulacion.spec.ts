/**
 * Pruebas del aviso semanal de liquidaciones pendientes de anular y del cron semanal genérico.
 * Ejecutar: npm run test:notif-liq-pendiente-anulacion
 */
import * as assert from 'node:assert/strict';
import {
  LiquidacionPendienteAnulacionEvaluator,
  semanaIso,
} from './liquidacion-pendiente-anulacion.evaluator';
import { NotificacionesCronService } from '../notificaciones-cron.service';
import type { NotificacionEvaluator } from './notificacion-evaluator.interface';

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

type Row = Record<string, any>;

const LIQS: Row[] = [
  {
    id: 'l1',
    tenantId: 'org_A',
    estado: 'pendiente_anulacion',
    ptoVenta: 3,
    cbteNro: 125,
    liquido: 150000.5,
    anulacionPendienteDesde: new Date('2026-10-01T15:00:00Z'),
    transportista: { nombre: 'Transportes Sur' },
  },
  { id: 'l2', tenantId: 'org_A', estado: 'autorizado', liquido: 1, transportista: { nombre: 'X' } },
  { id: 'l3', tenantId: 'org_B', estado: 'pendiente_anulacion', liquido: 1, transportista: { nombre: 'Y' } },
];

function prismaLiquidaciones() {
  return {
    liquidacion: {
      findMany: async ({ where }: Row) =>
        LIQS.filter((l) => l.tenantId === where.tenantId && l.estado === where.estado),
    },
  };
}

(async () => {
  await test('semanaIso: semanas ISO conocidas', () => {
    assert.equal(semanaIso(new Date('2026-10-12T11:00:00Z')), '2026-W42');
    assert.equal(semanaIso(new Date('2027-01-01T11:00:00Z')), '2026-W53');
    assert.equal(semanaIso(new Date('2026-01-01T11:00:00Z')), '2026-W01');
  });

  await test('evaluator: solo pendientes del tenant, con número, transportista y semana', async () => {
    const ev = new LiquidacionPendienteAnulacionEvaluator(prismaLiquidaciones() as never);
    const items = await ev.evaluar('org_A', new Date('2026-10-12T11:00:00Z'));
    assert.equal(items.length, 1);
    assert.equal(items[0].entidadId, 'l1:2026-W42');
    assert.equal(items[0].titulo, 'Liquidación 00003-00000125 — Transportes Sur');
    assert.match(items[0].detalle, /Pendiente de anular desde el 1\/10\/2026/);
  });

  await test('evaluator: otra semana → otro entidadId (el recordatorio se repite)', async () => {
    const ev = new LiquidacionPendienteAnulacionEvaluator(prismaLiquidaciones() as never);
    const a = await ev.evaluar('org_A', new Date('2026-10-12T11:00:00Z'));
    const b = await ev.evaluar('org_A', new Date('2026-10-19T11:00:00Z'));
    assert.notEqual(a[0].entidadId, b[0].entidadId);
  });

  // ── cronSemanal ──
  function crearCron(tenants: Row[]) {
    const envios: Row[] = [];
    const evaluados: string[] = [];
    const prisma = {
      tenant: { findMany: async () => tenants },
      notificacionEnvio: {
        findMany: async ({ where }: Row) =>
          envios.filter(
            (e) => e.tenantId === where.tenantId && e.tipo === where.tipo && where.entidadId.in.includes(e.entidadId),
          ),
        createMany: async ({ data }: Row) => {
          envios.push(...data);
          return { count: data.length };
        },
      },
    };
    const config = { isActivo: async () => true, getDestinatarios: async () => [] };
    const email = { send: async () => true };
    const users = { listByTenant: async () => [{ userId: 'u1', role: 'org:admin', email: 'admin@vialto.uno' }] };
    const ev = (tipo: string): NotificacionEvaluator => ({
      tipo,
      evaluar: async (tenantId: string) => {
        evaluados.push(`${tenantId}:${tipo}`);
        return [{ entidadId: `${tenantId}-1`, titulo: 't', detalle: 'd' }];
      },
    });
    const cron = new NotificacionesCronService(
      prisma as never,
      config as never,
      email as never,
      users as never,
      ev('facturacion.facturaPorVencer') as never,
      ev('facturacion.facturaVencida') as never,
      ev('combustible.cargaSospechosa') as never,
      ev('cuenta-corriente.vencimiento') as never,
      ev('liquidaciones.pendienteAnulacion') as never,
    );
    return { cron, envios, evaluados };
  }

  await test('cronSemanal: avisa pendientes de anular solo a tenants con el módulo, sin tocar combustible ni diarios', async () => {
    const { cron, envios, evaluados } = crearCron([
      { clerkOrgId: 'org_A', modules: ['emision-liquido-producto-arca', 'combustible', 'facturacion'] },
      { clerkOrgId: 'org_B', modules: ['combustible'] },
    ]);
    await cron.cronSemanal();
    assert.deepEqual(evaluados, ['org_A:liquidaciones.pendienteAnulacion']);
    assert.equal(envios.length, 1);
    assert.equal(envios[0].tipo, 'liquidaciones.pendienteAnulacion');
  });

  await test('procesarTenant con tipos: el cron de combustible no dispara el aviso de liquidaciones', async () => {
    const { cron, evaluados } = crearCron([]);
    await cron.procesarTenant('org_A', ['emision-liquido-producto-arca', 'combustible'], 'semanal', [
      'combustible.cargaSospechosa',
    ]);
    assert.deepEqual(evaluados, ['org_A:combustible.cargaSospechosa']);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
  console.log('\nTodas las pruebas pasaron');
})();
