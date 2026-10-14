/**
 * Backfill de Cuenta Corriente: genera/actualiza los movimientos de las facturas de
 * cliente y de las liquidaciones a proveedores que ya existían. La cuenta corriente
 * depende solo de facturas y liquidaciones (los viajes no generan movimientos), así que
 * esto alcanza para que una empresa que prende el módulo vea su historial completo.
 *
 * Instancia el contexto real de Nest para las facturas (reutiliza
 * `FacturacionService.backfillCuentaCorriente`, con su cálculo de cobro) y usa la misma
 * función plana que corre en producción para las liquidaciones
 * (`sincronizarCargoLiquidacionCc`). Módulo standalone mínimo: no levanta crons ni
 * notificaciones.
 *
 * Idempotente: correr de nuevo no duplica nada.
 *
 * Uso:
 *   npm run backfill:cuenta-corriente:dry                    ← preview, sin escribir
 *   npm run backfill:cuenta-corriente                         ← aplica
 *   npm run backfill:cuenta-corriente -- --tenant-id org_xxx  ← limita a un tenant
 */

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../src/shared/prisma/prisma.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { VialtoSharedModule } from '../src/shared/vialto-shared.module';
import { AuthModule } from '../src/core/auth/auth.module';
import { FacturacionModule } from '../src/modules/facturacion/facturacion.module';
import { FacturacionService } from '../src/modules/facturacion/facturacion.service';
import { sincronizarCargoLiquidacionCc } from '../src/modules/liquidaciones-arca/liquidacion-cuenta-corriente';

@Module({
  imports: [PrismaModule, VialtoSharedModule, AuthModule, FacturacionModule],
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
  console.log('  Backfill: movimientos de Cuenta Corriente (facturas y liquidaciones)');
  console.log(`  Modo: ${isDryRun ? '🔍 DRY RUN (sin cambios en BD)' : '✍️  APLICANDO CAMBIOS'}`);
  if (tenantId) console.log(`  Tenant: ${tenantId}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const app = await NestFactory.createApplicationContext(BackfillCuentaCorrienteModule, {
    logger: ['error', 'warn'],
  });

  try {
    const facturacionService = app.get(FacturacionService);
    const prisma = app.get(PrismaService);

    console.log('— Facturas (clientes) —');
    const resultadosFacturas = await facturacionService.backfillCuentaCorriente({
      tenantId,
      dryRun: isDryRun,
    });
    resultadosFacturas.forEach((r) => console.log('  ' + r));
    if (resultadosFacturas.length === 0) console.log('  (sin facturas de cliente)');

    console.log('\n— Liquidaciones (proveedores) —');
    const liquidaciones = await prisma.liquidacion.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, tenantId: true, estado: true, liquido: true },
    });
    for (const liq of liquidaciones) {
      const existe = await prisma.movimientoCuentaCorriente.findFirst({
        where: { tenantId: liq.tenantId, liquidacionId: liq.id, tipo: 'cargo' },
        select: { id: true },
      });
      console.log(
        `  [liquidación] ${liq.tenantId} ${liq.id} (${liq.estado}) → ${existe ? 'update' : 'CREATE'} $${liq.liquido}`,
      );
      if (!isDryRun) {
        try {
          await sincronizarCargoLiquidacionCc(prisma, liq.tenantId, liq.id);
        } catch (e) {
          console.log(`    ⚠️ SKIP (${e instanceof Error ? e.message : String(e)})`);
        }
      }
    }
    if (liquidaciones.length === 0) console.log('  (sin liquidaciones)');

    const total = resultadosFacturas.length + liquidaciones.length;
    console.log(
      `\n${isDryRun ? '💡 Ejecutar sin --dry-run para aplicar.' : '✅ Backfill completado.'} (${total} comprobantes evaluados)`,
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
