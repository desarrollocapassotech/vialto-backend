/**
 * Backfill histórico de Cuenta Corriente: genera/actualiza los cargos de
 * `MovimientoCuentaCorriente` para viajes finalizados y facturas de cliente que ya
 * existían ANTES de que esta integración se implementara. Sin esto, un tenant que
 * prenda el módulo `cuenta-corriente` solo vería actividad nueva a partir de ese
 * momento — el historial previo nunca disparó los hooks de
 * `viajes.service.ts`/`facturacion.service.ts` porque esos corren dentro de los
 * métodos de alta/edición (update, addGasto, createFactura, addPagoTransportista...),
 * no retroactivamente sobre lo que ya estaba en la base.
 *
 * A diferencia de otros scripts de este repo, este SÍ instancia el contexto real de
 * Nest (`NestFactory.createApplicationContext`) en vez de reimplementar la lógica a
 * mano con Prisma crudo — el cálculo del lado proveedor (`calcularAcordado`, que
 * contempla Liquidaciones ARCA) es demasiado complejo para duplicarlo sin riesgo de
 * que diverja de la lógica real. Usa un módulo standalone mínimo (no el `AppModule`
 * completo) para no levantar de paso cron jobs ni el envío de notificaciones.
 *
 * Idempotente: reutiliza los mismos `upsert` que ya corren en producción para
 * actividad nueva (`ViajesService.upsertCargoFinalizacion/upsertCargoTransportista`,
 * `FacturacionService.upsertCargoFactura`) — correr de nuevo no duplica nada.
 *
 * Uso:
 *   npm run backfill:cuenta-corriente:dry                    ← preview, sin escribir
 *   npm run backfill:cuenta-corriente                         ← aplica
 *   npm run backfill:cuenta-corriente -- --tenant-id org_xxx  ← limita a un tenant
 */

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../src/shared/prisma/prisma.module';
import { VialtoSharedModule } from '../src/shared/vialto-shared.module';
import { AuthModule } from '../src/core/auth/auth.module';
import { ViajesModule } from '../src/modules/viajes/viajes.module';
import { FacturacionModule } from '../src/modules/facturacion/facturacion.module';
import { ViajesService } from '../src/modules/viajes/viajes.service';
import { FacturacionService } from '../src/modules/facturacion/facturacion.service';

@Module({
  imports: [PrismaModule, VialtoSharedModule, AuthModule, ViajesModule, FacturacionModule],
})
class BackfillCuentaCorrienteModule {}

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantId = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantId };
}

async function main() {
  const { isDryRun, tenantId } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Backfill: cargos históricos de Cuenta Corriente');
  console.log(`  Modo: ${isDryRun ? '🔍 DRY RUN (sin cambios en BD)' : '✍️  APLICANDO CAMBIOS'}`);
  if (tenantId) console.log(`  Tenant: ${tenantId}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const app = await NestFactory.createApplicationContext(BackfillCuentaCorrienteModule, {
    logger: ['error', 'warn'],
  });

  try {
    const viajesService = app.get(ViajesService);
    const facturacionService = app.get(FacturacionService);

    console.log('— Viajes (cargos cliente + proveedor) —');
    const resultadosViajes = await viajesService.backfillCuentaCorriente({
      tenantId,
      dryRun: isDryRun,
    });
    resultadosViajes.forEach((r) => console.log('  ' + r));
    if (resultadosViajes.length === 0) console.log('  (sin viajes finalizados)');

    console.log('\n— Facturas (cargos cliente) —');
    const resultadosFacturas = await facturacionService.backfillCuentaCorriente({
      tenantId,
      dryRun: isDryRun,
    });
    resultadosFacturas.forEach((r) => console.log('  ' + r));
    if (resultadosFacturas.length === 0) console.log('  (sin facturas de cliente)');

    const total = resultadosViajes.length + resultadosFacturas.length;
    console.log(
      `\n${isDryRun ? '💡 Ejecutar sin --dry-run para aplicar.' : '✅ Backfill completado.'} (${total} movimientos evaluados)`,
    );
    console.log('══════════════════════════════════════════════════════════\n');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\n❌ Error fatal:', e);
  process.exit(1);
});
