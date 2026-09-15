/**
 * Reconstruye AsignacionVehiculo (COMB — asignación chofer↔vehículo, sep 2026) a
 * partir del historial real de CargaCombustible: por cada chofer, ordena sus cargas
 * por fecha y abre un tramo nuevo cada vez que cambia el vehiculoId respecto a la
 * carga anterior, cerrando el tramo previo en esa fecha. El último tramo de cada
 * chofer queda con `fechaHasta: null` (asignación vigente) — coincide con lo que
 * `CombustibleService.getUltimaCargaChofer` ya calculaba antes de este feature, así
 * que el default de patente en la app del chofer no cambia.
 *
 * Cargas sin choferId (~22% del total al momento de escribir esto) quedan afuera:
 * no hay a quién asignarle el vehículo. Cargas sin vehiculoId también se ignoran.
 *
 * Idempotente: salta por completo a cualquier chofer que ya tenga alguna fila en
 * AsignacionVehiculo (no mezcla asignaciones manuales del panel con este backfill).
 *
 * Un vehículo no puede quedar activo para dos choferes a la vez (misma regla que
 * `CombustibleService.asignarVehiculo` aplica en vivo) — acá no hay transacción por
 * fila que lo evite, así que se resuelve en memoria antes de escribir: si el último
 * tramo inferido de dos choferes distintos apunta al mismo vehículo, gana el de
 * `fechaDesde` más reciente (quien lo usó después) y al otro se le cierra ese tramo
 * en esa misma fecha, como si se lo hubieran "sacado" justo cuando el otro lo tomó.
 *
 * Uso:
 *   npm run backfill:asignacion-vehiculo:dry                    ← preview
 *   npm run backfill:asignacion-vehiculo                        ← aplica
 *   npm run backfill:asignacion-vehiculo -- --tenant-id org_xxx ← limita a un tenant
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantIdArg };
}

type CargaRow = {
  vehiculoId: string;
  fecha: Date;
  createdAt: Date;
};

type Tramo = {
  vehiculoId: string;
  fechaDesde: Date;
  fechaHasta: Date | null;
};

/** Agrupa cargas ordenadas cronológicamente en tramos por cambio de vehiculoId. */
function inferirTramos(cargas: CargaRow[]): Tramo[] {
  const tramos: Tramo[] = [];
  for (const c of cargas) {
    const actual = tramos[tramos.length - 1];
    if (!actual || actual.vehiculoId !== c.vehiculoId) {
      if (actual) actual.fechaHasta = c.fecha;
      tramos.push({ vehiculoId: c.vehiculoId, fechaDesde: c.fecha, fechaHasta: null });
    }
  }
  return tramos;
}

async function main() {
  const { isDryRun, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Backfill: historial de AsignacionVehiculo desde cargas de combustible');
  console.log(`  Modo: ${isDryRun ? '🔍 DRY RUN (sin cambios en BD)' : '✍️  APLICANDO CAMBIOS'}`);
  if (tenantIdArg) console.log(`  Tenant: ${tenantIdArg}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const tenants = await prisma.tenant.findMany({
    where: {
      modules: { has: 'combustible' },
      ...(tenantIdArg ? { clerkOrgId: tenantIdArg } : {}),
    },
    select: { clerkOrgId: true },
  });

  let totalTramos = 0;

  for (const t of tenants) {
    const choferes = await prisma.chofer.findMany({
      where: { tenantId: t.clerkOrgId },
      select: { id: true, nombre: true },
    });

    const yaAsignados = await prisma.asignacionVehiculo.findMany({
      where: { tenantId: t.clerkOrgId },
      select: { choferId: true },
      distinct: ['choferId'],
    });
    const choferesConAsignacion = new Set(yaAsignados.map((a) => a.choferId));

    const porChofer: { chofer: { id: string; nombre: string }; cantCargas: number; tramos: Tramo[] }[] = [];

    for (const chofer of choferes) {
      if (choferesConAsignacion.has(chofer.id)) {
        console.log(`[${t.clerkOrgId}] ${chofer.nombre} — ya tiene asignaciones, se saltea`);
        continue;
      }

      const cargas = await prisma.cargaCombustible.findMany({
        where: { tenantId: t.clerkOrgId, choferId: chofer.id, vehiculoId: { not: null } },
        select: { vehiculoId: true, fecha: true, createdAt: true },
        orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      });
      if (cargas.length === 0) continue;

      porChofer.push({
        chofer,
        cantCargas: cargas.length,
        tramos: inferirTramos(cargas as CargaRow[]),
      });
    }

    // Resuelve conflictos: si el tramo activo (el último, fechaHasta: null) de dos
    // choferes distintos apunta al mismo vehículo, gana el de fechaDesde más reciente.
    const activoPorVehiculo = new Map<string, (typeof porChofer)[number]>();
    for (const entry of porChofer) {
      const activo = entry.tramos[entry.tramos.length - 1];
      const actual = activoPorVehiculo.get(activo.vehiculoId);
      if (!actual) {
        activoPorVehiculo.set(activo.vehiculoId, entry);
        continue;
      }
      const activoActual = actual.tramos[actual.tramos.length - 1];
      const pierde = activo.fechaDesde > activoActual.fechaDesde ? actual : entry;
      const gana = pierde === actual ? entry : actual;
      const tramoPierde = pierde.tramos[pierde.tramos.length - 1];
      const tramoGana = gana.tramos[gana.tramos.length - 1];
      tramoPierde.fechaHasta = tramoGana.fechaDesde;
      console.log(
        `[${t.clerkOrgId}] ⚠️  conflicto en veh. ${tramoGana.vehiculoId.slice(-6)}: ${gana.chofer.nombre} y ${pierde.chofer.nombre} — se cierra el de ${pierde.chofer.nombre} el ${tramoPierde.fechaHasta.toISOString().slice(0, 10)} (gana ${gana.chofer.nombre})`,
      );
      activoPorVehiculo.set(tramoGana.vehiculoId, gana);
    }

    let tramosTenant = 0;

    for (const { chofer, cantCargas, tramos } of porChofer) {
      tramosTenant += tramos.length;

      console.log(
        `[${t.clerkOrgId}] ${chofer.nombre} — ${cantCargas} cargas → ${tramos.length} tramo(s)` +
          (isDryRun
            ? ': ' +
              tramos
                .map((tr) => `${tr.vehiculoId.slice(-6)} (${tr.fechaDesde.toISOString().slice(0, 10)} → ${tr.fechaHasta ? tr.fechaHasta.toISOString().slice(0, 10) : 'hoy'})`)
                .join(', ')
            : ''),
      );

      if (!isDryRun) {
        await prisma.asignacionVehiculo.createMany({
          data: tramos.map((tr) => ({
            tenantId: t.clerkOrgId,
            choferId: chofer.id,
            vehiculoId: tr.vehiculoId,
            fechaDesde: tr.fechaDesde,
            fechaHasta: tr.fechaHasta,
            createdBy: 'backfill:asignacion-vehiculo',
          })),
        });
      }
    }

    totalTramos += tramosTenant;
    if (tramosTenant > 0) {
      console.log(`[${t.clerkOrgId}] total: ${tramosTenant} tramo(s) ${isDryRun ? 'a crear' : 'creados'}\n`);
    }
  }

  console.log(`\nTotal general: ${totalTramos} tramo(s) ${isDryRun ? 'a crear' : 'creados'}.`);
  console.log(isDryRun ? '💡 Ejecutar sin --dry-run para aplicar.' : '✅ Backfill completado.');
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
