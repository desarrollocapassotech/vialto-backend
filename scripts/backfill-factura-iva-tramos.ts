/**
 * Recalcula neto + IVA persistido en facturas por tramo de tenants sin
 * `emision-facturas-arca` (caso LSF / Uruguay).
 *
 * - `importe` = suma completa de los viajes (no se descarta el resto si el
 *   viaje tiene tramos parciales).
 * - `ivaMonto` = IVA de cada tramo + el resto del neto con el IVA de cabecera
 *   (0% = parte exenta implícita).
 *
 * No toca tenants con ARCA ni facturas que no son por tramo.
 * No marca pagos ni cambia el estado de cobro: solo deja los montos bien.
 * Después de aplicar, el listado de facturas muestra el saldo real; LSF
 * confirma si esa diferencia ya se cobró afuera o sigue pendiente.
 *
 * Uso:
 *   npm run backfill:factura-iva-tramos:dry              ← preview
 *   npm run backfill:factura-iva-tramos                  ← aplica
 *   npm run backfill:factura-iva-tramos -- --tenant-id org_xxx
 */

import { PrismaClient } from '@prisma/client';
import {
  importeNetoFactura,
  importeOperativoFactura,
  ivaMontoDeTramos,
  roundMoney2,
} from '../src/shared/util/factura-estado-lectura';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { apply, tenantIdArg };
}

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const { apply, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Backfill IVA persistido — facturas por tramo (sin ARCA)');
  console.log(
    `  Modo: ${apply ? '✍️  APLICANDO CAMBIOS' : '🔍 DRY RUN (sin cambios en BD)'}`,
  );
  if (tenantIdArg) console.log(`  Tenant: ${tenantIdArg}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const tenants = await prisma.tenant.findMany({
    where: tenantIdArg ? { clerkOrgId: tenantIdArg } : undefined,
    select: { clerkOrgId: true, name: true, modules: true },
  });
  const sinArca = tenants.filter(
    (t) => !t.modules.includes('emision-facturas-arca'),
  );
  if (sinArca.length === 0) {
    console.log('No hay tenants sin emision-facturas-arca para procesar.');
    return;
  }

  const tenantName = new Map(sinArca.map((t) => [t.clerkOrgId, t.name]));
  const facturas = await prisma.factura.findMany({
    where: {
      facturarPorTramo: true,
      tenantId: { in: sinArca.map((t) => t.clerkOrgId) },
    },
    include: {
      viajes: {
        select: {
          id: true,
          monto: true,
          cantidadFactura: true,
          precioUnitarioFactura: true,
        },
      },
      tramos: { select: { viajeId: true, monto: true, ivaPct: true } },
      pagos: { select: { importe: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { fechaEmision: 'asc' }],
  });

  console.log(`Facturas por tramo encontradas: ${facturas.length}\n`);

  type Row = {
    tenant: string;
    numero: string;
    id: string;
    importeAntes: number;
    importeNuevo: number;
    ivaAntes: number | null;
    ivaNuevo: number | null;
    aCobrar: number;
    pagado: number;
    saldo: number;
  };

  const cambiadas: Row[] = [];
  const conSaldo: Row[] = [];

  for (const f of facturas) {
    const neto = importeNetoFactura(f.importe, f.viajes);
    const ivaNuevo =
      f.tramos.length > 0
        ? ivaMontoDeTramos(neto, f.tramos, f.ivaPct)
        : null;
    const aCobrar = importeOperativoFactura(neto, f.viajes, {
      facturarPorTramo: true,
      tramos: f.tramos,
      ivaPctCabecera: f.ivaPct,
      ivaMontoGuardado: ivaNuevo,
    });
    const pagado = roundMoney2(f.pagos.reduce((s, p) => s + p.importe, 0));
    const saldo = roundMoney2(Math.max(0, aCobrar - pagado));

    const importeCambia = Math.abs(roundMoney2(f.importe) - neto) > 0.004;
    const ivaCambia =
      (f.ivaMonto == null && ivaNuevo != null) ||
      (f.ivaMonto != null && ivaNuevo == null) ||
      (f.ivaMonto != null &&
        ivaNuevo != null &&
        Math.abs(f.ivaMonto - ivaNuevo) > 0.004);

    const row: Row = {
      tenant: tenantName.get(f.tenantId) ?? f.tenantId,
      numero: f.numero ?? `(sin número ${f.id.slice(0, 8)})`,
      id: f.id,
      importeAntes: f.importe,
      importeNuevo: neto,
      ivaAntes: f.ivaMonto,
      ivaNuevo,
      aCobrar,
      pagado,
      saldo,
    };

    if (importeCambia || ivaCambia) cambiadas.push(row);
    if (saldo > 0.005) conSaldo.push(row);

    if (apply && (importeCambia || ivaCambia)) {
      await prisma.factura.update({
        where: { id: f.id },
        data: { importe: neto, ivaMonto: ivaNuevo },
      });
    }
  }

  if (cambiadas.length === 0) {
    console.log('Ninguna factura necesita actualizar importe/ivaMonto.');
  } else {
    console.log(`Facturas a actualizar: ${cambiadas.length}`);
    console.log('─────────────────────────────────────────────────────────');
    for (const r of cambiadas) {
      console.log(
        `  [${r.tenant}] ${r.numero}  neto ${fmtMoney(r.importeAntes)} → ${fmtMoney(r.importeNuevo)}  IVA ${r.ivaAntes == null ? '—' : fmtMoney(r.ivaAntes)} → ${r.ivaNuevo == null ? '—' : fmtMoney(r.ivaNuevo)}`,
      );
    }
    console.log('');
  }

  console.log(
    `Facturas con diferencia a cobrar (neto+IVA − pagos > 0): ${conSaldo.length}`,
  );
  if (conSaldo.length > 0) {
    console.log('─────────────────────────────────────────────────────────');
    console.log(
      '  LSF tiene que confirmar si esa diferencia ya se cobró por fuera o sigue pendiente.',
    );
    for (const r of conSaldo) {
      console.log(
        `  [${r.tenant}] ${r.numero}  a cobrar ${fmtMoney(r.aCobrar)}  pagado ${fmtMoney(r.pagado)}  SALDO ${fmtMoney(r.saldo)}`,
      );
    }
  }

  console.log('\nHecho.');
  if (!apply && (cambiadas.length > 0 || conSaldo.length > 0)) {
    console.log('Para persistir: npm run backfill:factura-iva-tramos\n');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
