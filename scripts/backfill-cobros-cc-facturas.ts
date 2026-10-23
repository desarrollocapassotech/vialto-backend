/**
 * Genera en Cuenta corriente el cobro imputado de cada `Pago` cargado desde Facturas
 * ("Registrar pago" / "Marcar como cobrada") antes de que ese camino lo hiciera solo.
 *
 * Por qué: esos pagos ponían la venta de CC en `cancelado` (el estado sale de los
 * `Pago`), pero no creaban cobro ni imputación. En CC la factura se veía saldada sin
 * ningún cobro, no se podía imputar y "Ver imputación" no existía (LSF, oct 2026).
 *
 * Usa la misma función que corre en producción (`registrarCobroCcDesdeFactura`): un
 * "COBRO" por pago, con la fecha y forma de pago del pago, imputado a la venta con
 * `pagoFacturacionId` = el pago. Solo toma pagos que ninguna imputación espeja todavía
 * (los que nacieron en CC ya la tienen), así que es idempotente. Facturas sin venta en CC
 * o con la venta anulada se saltean. No cambia ningún `Pago` ni el estado de la venta.
 *
 * Uso:
 *   npm run backfill:cobros-cc-facturas:dry                    ← preview
 *   npm run backfill:cobros-cc-facturas                        ← aplica
 *   npm run backfill:cobros-cc-facturas -- --tenant-id org_xxx ← limita a un tenant
 */

import { PrismaClient } from '@prisma/client';
import { registrarCobroCcDesdeFactura } from '../src/modules/facturacion/factura-cuenta-corriente';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantId = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { apply, tenantId };
}

async function main() {
  const { apply, tenantId } = parseArgs();
  console.log(`\nBackfill cobros CC desde Facturas — ${apply ? 'APLICANDO' : 'DRY RUN'}${tenantId ? ` — ${tenantId}` : ''}\n`);

  const espejados = await prisma.imputacionCuentaCorriente.findMany({
    where: { pagoFacturacionId: { not: null }, ...(tenantId ? { tenantId } : {}) },
    select: { pagoFacturacionId: true },
  });
  const pagos = await prisma.pago.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      id: { notIn: espejados.map((e) => e.pagoFacturacionId!) },
    },
    include: { factura: { select: { numero: true } } },
    orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
  });

  let creados = 0;
  let salteados = 0;
  let total = 0;
  for (const pago of pagos) {
    const cargo = await prisma.movimientoCuentaCorriente.findFirst({
      where: {
        tenantId: pago.tenantId,
        facturaId: pago.facturaId,
        tipo: 'cargo',
        estadoDisponibilidad: { not: 'anulado' },
      },
      select: { id: true },
    });
    const etiqueta = `${pago.tenantId} factura ${pago.factura.numero ?? pago.facturaId} pago ${pago.id} $${pago.importe} (${pago.fecha.toISOString().slice(0, 10)})`;
    if (!cargo) {
      salteados += 1;
      console.log(`  SKIP ${etiqueta} — sin venta en CC o anulada`);
      continue;
    }
    console.log(`  COBRO ${etiqueta}`);
    creados += 1;
    total += pago.importe;
    if (apply) {
      await prisma.$transaction(
        (tx) => registrarCobroCcDesdeFactura(tx, pago.tenantId, pago),
        { timeout: 20_000, maxWait: 10_000 },
      );
    }
  }

  console.log(
    `\n${creados} cobros ${apply ? 'creados' : 'a crear'} ($${total.toFixed(2)}), ${salteados} salteados.` +
      (apply ? '' : ' Correr con --apply para aplicar.') +
      '\n',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
