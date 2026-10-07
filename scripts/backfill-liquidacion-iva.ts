/**
 * Recalcula el IVA total (`gastosAdminIva`) y el líquido de las liquidaciones
 * que todavía no se emitieron ante AFIP.
 *
 * Por qué: `gastosAdminIva` empezó guardando solo el IVA de gastos
 * administrativos (siempre 0) y después pasó a ser el IVA total del
 * comprobante. La migración `20260727180000_liquidacion_iva_pct` le puso
 * alícuota (21% por defecto) a las liquidaciones viejas, pero no recalculó el
 * monto: quedaron con "21%" e IVA $0, y el líquido sin IVA.
 *
 * Usa el mismo cálculo que al emitir (`computeLiquidacionTotales`, con la
 * alícuota guardada de la liquidación, sus conceptos y los precios de sus
 * viajes) — es lo que `emitirLiquidacion` haría de todos modos antes de
 * mandar a AFIP.
 *
 * Solo toca liquidaciones sin CAE en estado `borrador` o `error`. Nunca toca
 * autorizadas, anuladas ni `pendiente_cae`: su comprobante ante AFIP ya tiene
 * esos montos.
 *
 * OJO tenants sin `emision-liquido-producto-arca`: sus liquidaciones quedan en
 * `borrador` para siempre aunque sean registros definitivos; recalcular cambia
 * el líquido (y con él el costo/ganancia del viaje). El dry run los marca para
 * revisarlos antes de aplicar; `--solo-arca` los excluye.
 *
 * Uso:
 *   npm run backfill:liquidacion-iva:dry                  ← preview
 *   npm run backfill:liquidacion-iva                      ← aplica
 *   npm run backfill:liquidacion-iva -- --tenant-id org_xxx
 *   npm run backfill:liquidacion-iva -- --solo-arca
 */

import { PrismaClient } from '@prisma/client';
import { round2 } from '../src/modules/liquidaciones-arca/arca-iva.util';
import {
  computeLiquidacionTotales,
  type ConceptoLineaInput,
} from '../src/modules/liquidaciones-arca/cvlp-conceptos.util';

const prisma = new PrismaClient();

const MODULO_ARCA = 'emision-liquido-producto-arca';
const ESTADOS_RECALCULABLES = ['borrador', 'error'];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const soloArca = args.includes('--solo-arca');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { apply, soloArca, tenantIdArg };
}

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const { apply, soloArca, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Backfill IVA total — liquidaciones sin emitir');
  console.log(
    `  Modo: ${apply ? '✍️  APLICANDO CAMBIOS' : '🔍 DRY RUN (sin cambios en BD)'}`,
  );
  if (tenantIdArg) console.log(`  Tenant: ${tenantIdArg}`);
  if (soloArca) console.log(`  Solo tenants con ${MODULO_ARCA}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const tenants = await prisma.tenant.findMany({
    where: tenantIdArg ? { clerkOrgId: tenantIdArg } : undefined,
    select: { clerkOrgId: true, name: true, modules: true },
  });
  const tenantsObjetivo = soloArca
    ? tenants.filter((t) => t.modules.includes(MODULO_ARCA))
    : tenants;
  if (tenantsObjetivo.length === 0) {
    console.log('No hay tenants para procesar.');
    return;
  }

  let revisadas = 0;
  let conCambio = 0;
  let aplicadas = 0;

  for (const tenant of tenantsObjetivo) {
    const tenantId = tenant.clerkOrgId;
    const tieneArca = tenant.modules.includes(MODULO_ARCA);
    const config = await prisma.arcaConfig.findUnique({
      where: { tenantId },
      select: { ivaGastosAdmin: true },
    });

    const liquidaciones = await prisma.liquidacion.findMany({
      where: {
        tenantId,
        estado: { in: ESTADOS_RECALCULABLES },
        cae: null,
      },
      include: {
        transportista: { select: { nombre: true } },
        viajes: {
          where: { tenantId },
          select: {
            viajeId: true,
            viaje: {
              select: {
                numero: true,
                cantidadTransportista: true,
                precioUnitarioTransportista: true,
                precioTransportistaExterno: true,
                precioTransportistaIvaIncluidoPct: true,
              },
            },
          },
        },
        conceptosLineas: {
          where: { tenantId },
          orderBy: { orden: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (liquidaciones.length === 0) continue;

    const cambios: string[] = [];
    for (const liq of liquidaciones) {
      revisadas++;
      const ivaPct = liq.ivaPct ?? config?.ivaGastosAdmin ?? 21;
      const lineas: ConceptoLineaInput[] = liq.conceptosLineas.map((r) => ({
        nombreSnapshot: r.nombreSnapshot,
        signo: r.signo as 'favor' | 'contra',
        ivaPct: r.ivaPct,
        monto: r.monto,
        orden: r.orden,
        modoAplicacion: r.modoAplicacion,
        viajeId: r.viajeId,
      }));
      // Mismo armado que `emitirLiquidacion` en liquidaciones.service.ts.
      const viajesPayload = liq.viajes.map((v) => {
        const tnDestino = v.viaje.cantidadTransportista ?? null;
        const tarifa = v.viaje.precioUnitarioTransportista ?? null;
        const subtotal =
          tnDestino != null && tarifa != null
            ? round2(tnDestino * tarifa)
            : round2(v.viaje.precioTransportistaExterno ?? 0);
        return {
          id: v.viajeId,
          numero: v.viaje.numero ?? '',
          bruto: subtotal,
          comision: round2((subtotal * liq.comisionPct) / 100),
          ivaPct: v.viaje.precioTransportistaIvaIncluidoPct || undefined,
        };
      });

      const montos = computeLiquidacionTotales({
        bruto: liq.bruto,
        comision: liq.comision,
        ivaPctDefault: ivaPct,
        lineas,
        viajes: viajesPayload,
      });

      const ivaActual = round2(liq.gastosAdminIva);
      const liquidoActual = round2(liq.liquido);
      if (montos.impIva === ivaActual && montos.liquido === liquidoActual) {
        continue;
      }
      conCambio++;
      cambios.push(
        `  · ${liq.id} · ${liq.transportista?.nombre ?? liq.transportistaId} · ${liq.estado}` +
          ` · bruto $${fmtMoney(liq.bruto)} · IVA ${ivaPct}%` +
          `\n      IVA     $${fmtMoney(ivaActual)} → $${fmtMoney(montos.impIva)}` +
          `\n      líquido $${fmtMoney(liquidoActual)} → $${fmtMoney(montos.liquido)}`,
      );

      if (apply) {
        const { count } = await prisma.liquidacion.updateMany({
          where: {
            id: liq.id,
            tenantId,
            estado: { in: ESTADOS_RECALCULABLES },
            cae: null,
          },
          data: {
            gastosAdminIva: montos.impIva,
            liquido: montos.liquido,
            updatedAt: new Date(),
          },
        });
        aplicadas += count;
      }
    }

    if (cambios.length > 0) {
      console.log(
        `\n▶ ${tenant.name} (${tenantId})${tieneArca ? '' : '  ⚠️ sin ARCA: estas liquidaciones son registros manuales definitivos, revisar antes de aplicar'}`,
      );
      for (const c of cambios) console.log(c);
    }
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  Liquidaciones revisadas: ${revisadas}`);
  console.log(`  Con IVA/líquido desfasado: ${conCambio}`);
  if (apply) console.log(`  Actualizadas: ${aplicadas}`);
  else if (conCambio > 0)
    console.log('  Para aplicar: npm run backfill:liquidacion-iva');
  console.log('──────────────────────────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
