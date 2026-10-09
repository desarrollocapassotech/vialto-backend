/**
 * Pruebas de los avisos de mantenimiento (MANT-03): textos/entidadId y registro de evaluators.
 * Ejecutar: npm run test:mant-avisos
 */
import * as assert from 'node:assert/strict';
import { armarAvisosVencimiento } from './vencimientos-avisos.util';
import type { FilaVencimiento } from './vencimientos.util';
import { NotificacionesCronService } from '../notificaciones/notificaciones-cron.service';
import type { NotificacionEvaluator } from '../notificaciones/evaluators/notificacion-evaluator.interface';

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

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fila = (o: Partial<FilaVencimiento>): FilaVencimiento =>
  ({
    vehiculoPlanId: 'vp1',
    vehiculo: { id: 'v1', patente: 'AD271ZN', tipo: 'tractor' },
    plan: { id: 'p1', nombre: 'Service 20.000', categoria: 'mecanico', intervaloKm: 20_000, intervaloDias: null, avisoKm: 2_000, avisoDias: null, tareas: [] },
    referencia: { tipo: 'base', id: 'base', ordenNumero: null, km: 100_000, fecha: null },
    odometro: { km: 118_500, fecha: d('2026-10-01'), fuente: 'carga', fuenteId: 'c1' },
    kmPorDia: 100,
    estado: 'proximo',
    proximoKm: 120_000,
    kmRestantes: 1_500,
    proximaFecha: null,
    diasRestantes: null,
    fechaEstimada: d('2026-10-15'),
    motivo: 'km',
    ...o,
  }) as FilaVencimiento;

(async () => {
  await test('próximo por km: texto, título y entidadId con base', () => {
    const [a] = armarAvisosVencimiento([fila({})], 'proximo');
    assert.equal(a.entidadId, 'vp1:base');
    assert.equal(a.titulo, 'AD271ZN — Service 20.000');
    assert.equal(
      a.detalle,
      'Faltan 1.500 km (próximo service a los 120.000 km; estimado 15/10/2026). Km actual: 118.500 (carga de combustible del 01/10/2026).',
    );
  });

  await test('vencido por km con referencia en una OT: entidadId con el id de la OT', () => {
    const [a] = armarAvisosVencimiento(
      [fila({ estado: 'vencido', kmRestantes: -1_000, referencia: { tipo: 'orden', id: 'o7', ordenNumero: 7, km: 100_000, fecha: d('2026-06-01') }, odometro: { km: 121_000, fecha: d('2026-10-02'), fuente: 'edicion', fuenteId: 'e1' } })],
      'vencido',
    );
    assert.equal(a.entidadId, 'vp1:o7');
    assert.equal(a.detalle, 'Pasado por 1.000 km (tocaba a los 120.000 km). Km actual: 121.000 (corrección manual del 02/10/2026).');
  });

  await test('km de respaldo del vehículo: sin fecha de lectura', () => {
    const [a] = armarAvisosVencimiento(
      [fila({ estado: 'vencido', kmRestantes: -50, proximoKm: 1_000, odometro: { km: 1_050, fecha: d('2026-05-21'), fuente: 'vehiculo', fuenteId: 'v1' } })],
      'vencido',
    );
    assert.equal(a.detalle, 'Pasado por 50 km (tocaba a los 1.000 km). Km actual: 1.050 (cargado en el vehículo).');
  });

  await test('próximo y vencido por fecha', () => {
    const base = { motivo: 'fecha' as const, kmRestantes: null, proximoKm: null, odometro: null };
    const [p] = armarAvisosVencimiento([fila({ ...base, proximaFecha: d('2026-10-20'), diasRestantes: 15 })], 'proximo');
    assert.equal(p.detalle, 'Faltan 15 días (vence el 20/10/2026).');
    const [v] = armarAvisosVencimiento([fila({ ...base, estado: 'vencido', proximaFecha: d('2026-09-20'), diasRestantes: -15 })], 'vencido');
    assert.equal(v.detalle, 'Venció el 20/09/2026 (hace 15 días).');
    const [h] = armarAvisosVencimiento([fila({ ...base, estado: 'vencido', proximaFecha: d('2026-10-05'), diasRestantes: 0 })], 'vencido');
    assert.equal(h.detalle, 'Venció el 05/10/2026 (hoy).');
    const [u] = armarAvisosVencimiento([fila({ ...base, proximaFecha: d('2026-10-06'), diasRestantes: 1 })], 'proximo');
    assert.equal(u.detalle, 'Faltan 1 día (vence el 06/10/2026).');
  });

  await test('filtra por estado y omite filas sin referencia', () => {
    const r = armarAvisosVencimiento(
      [fila({}), fila({ vehiculoPlanId: 'vp2', estado: 'vencido' }), fila({ vehiculoPlanId: 'vp3', referencia: null }), fila({ vehiculoPlanId: 'vp4', estado: 'ok' })],
      'proximo',
    );
    assert.deepEqual(r.map((a) => a.entidadId), ['vp1:base']);
  });

  // ── Registro de evaluators en NotificacionesCronService ──
  type Row = Record<string, any>;
  function crearCron(opts: { activo?: boolean } = {}) {
    const envios: Row[] = [];
    const prisma = {
      notificacionEnvio: {
        findMany: async ({ where }: Row) => envios.filter((e) => e.tenantId === where.tenantId && e.tipo === where.tipo && where.entidadId.in.includes(e.entidadId)),
        createMany: async ({ data }: Row) => { envios.push(...data); return { count: data.length }; },
      },
    };
    const config = { isActivo: async () => opts.activo ?? true, getDestinatarios: async () => [] };
    const email = { send: async () => true };
    const users = { listByTenant: async () => [{ userId: 'u1', role: 'org:admin', email: 'admin@vialto.uno' }] };
    const dummy = { tipo: 'x', evaluar: async () => [] };
    const cron = new NotificacionesCronService(
      prisma as never, config as never, email as never, users as never, dummy as never, dummy as never, dummy as never, dummy as never, dummy as never,
    );
    return { cron, envios };
  }
  const evaluator = (tipo: string): NotificacionEvaluator => ({
    tipo,
    evaluar: async () => [{ entidadId: 'vp1:base', titulo: 'AAA — Service', detalle: 'Faltan 1.000 km.' }],
  });

  await test('registrar un tipo que no está en el catálogo → error', () => {
    const { cron } = crearCron();
    assert.throws(() => cron.registrarEvaluator(evaluator('mantenimiento.inventado')), /no está en NOTIFICACIONES_CATALOG/);
  });

  await test('registrar el mismo tipo dos veces → error', () => {
    const { cron } = crearCron();
    cron.registrarEvaluator(evaluator('mantenimiento.vencido'));
    assert.throws(() => cron.registrarEvaluator(evaluator('mantenimiento.vencido')), /ya hay un evaluator/);
  });

  await test('el evaluator registrado corre solo si el tenant tiene el módulo; dedup en la 2ª corrida', async () => {
    const { cron, envios } = crearCron();
    cron.registrarEvaluator(evaluator('mantenimiento.vencido'));
    await cron.procesarTenant('org_A', ['combustible'], 'diaria');
    assert.equal(envios.length, 0, 'sin el módulo no se evalúa');
    await cron.procesarTenant('org_A', ['mantenimiento'], 'diaria');
    await cron.procesarTenant('org_A', ['mantenimiento'], 'diaria');
    assert.deepEqual(envios.map((e) => `${e.tipo}:${e.entidadId}`), ['mantenimiento.vencido:vp1:base']);
  });

  await test('con el toggle apagado no se evalúa', async () => {
    const { cron, envios } = crearCron({ activo: false });
    cron.registrarEvaluator(evaluator('mantenimiento.vencido'));
    await cron.procesarTenant('org_A', ['mantenimiento'], 'diaria');
    assert.equal(envios.length, 0);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
