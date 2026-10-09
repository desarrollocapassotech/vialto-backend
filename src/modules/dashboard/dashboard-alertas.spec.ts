/**
 * Pruebas del registro de bloques del "Resumen de alertas" (MANT-03-T3).
 * Ejecutar: npm run test:dashboard-alertas
 */
import * as assert from 'node:assert/strict';
import { DashboardAlertasRegistry, type ProveedorBloqueAlerta } from './dashboard-alertas.registry';
import { DashboardService } from './dashboard.service';
import { VencimientosAlertaProveedor } from '../mantenimiento/dashboard/vencimientos-alerta.proveedor';
import type { VencimientosService } from '../mantenimiento/vencimientos.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { TenantFieldConfigService } from '../../core/tenant-field-config/tenant-field-config.service';

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

/** Tenant sin facturación/viajes/stock/combustible: el dashboard solo corre los bloques registrados. */
function crearDashboard(modules: string[], proveedor?: ProveedorBloqueAlerta) {
  const registry = new DashboardAlertasRegistry();
  if (proveedor) registry.registrar(proveedor);
  const prisma = { tenant: { findUnique: async () => ({ modules }) } };
  return new DashboardService(prisma as unknown as PrismaService, {} as TenantFieldConfigService, registry);
}

function proveedor(resultado: (() => Promise<any>) | { cantidad: number; vencidos: number; proximos: number }) {
  let llamadas = 0;
  const p: ProveedorBloqueAlerta = {
    clave: 'mantenimiento',
    requiereModulo: 'mantenimiento',
    obtener: async () => {
      llamadas++;
      return typeof resultado === 'function' ? resultado() : resultado;
    },
  };
  return { p, llamadas: () => llamadas };
}

(async () => {
  await test('registry: clave repetida → error', () => {
    const r = new DashboardAlertasRegistry();
    r.registrar(proveedor({ cantidad: 0, vencidos: 0, proximos: 0 }).p);
    assert.throws(() => r.registrar(proveedor({ cantidad: 0, vencidos: 0, proximos: 0 }).p), /ya hay un proveedor/);
  });

  await test('bloque con cantidad > 0 → aparece en alertas (facturas/viajes vacíos)', async () => {
    const { p } = proveedor({ cantidad: 3, vencidos: 1, proximos: 2 });
    const out = await crearDashboard(['mantenimiento'], p).getOwnerDashboard('org_A', 'month');
    assert.deepEqual(out.alertas?.mantenimiento, { cantidad: 3, vencidos: 1, proximos: 2 });
    assert.equal(out.alertas?.facturasVencidas.cantidad, 0);
    assert.equal(out.alertas?.viajesSinFactura.cantidad, 0);
  });

  await test('cantidad 0 → alertas null', async () => {
    const { p } = proveedor({ cantidad: 0, vencidos: 0, proximos: 0 });
    const out = await crearDashboard(['mantenimiento'], p).getOwnerDashboard('org_A', 'month');
    assert.equal(out.alertas ?? null, null);
  });

  await test('tenant sin el módulo → el proveedor ni se llama', async () => {
    const { p, llamadas } = proveedor({ cantidad: 5, vencidos: 5, proximos: 0 });
    const out = await crearDashboard(['stock_viewer_x'], p).getOwnerDashboard('org_A', 'month');
    assert.equal(llamadas(), 0);
    assert.equal(out.alertas ?? null, null);
  });

  await test('proveedor que falla → el dashboard responde igual, sin el bloque', async () => {
    const { p } = proveedor(async () => {
      throw new Error('boom');
    });
    const out = await crearDashboard(['mantenimiento'], p).getOwnerDashboard('org_A', 'month');
    assert.equal(out.alertas ?? null, null);
    assert.ok(out.period);
  });

  await test('proveedor de Mantenimiento: vencidos + próximos (sin datos no cuenta) y se registra solo', async () => {
    const registry = new DashboardAlertasRegistry();
    const vencimientos = { resumen: async () => ({ vencido: 2, proximo: 3, sin_datos: 7, ok: 10, total: 22 }) };
    const prov = new VencimientosAlertaProveedor(vencimientos as unknown as VencimientosService, registry);
    prov.onModuleInit();
    assert.equal(registry.proveedores()[0], prov);
    assert.deepEqual(await prov.obtener('org_A'), { cantidad: 5, vencidos: 2, proximos: 3 });
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
