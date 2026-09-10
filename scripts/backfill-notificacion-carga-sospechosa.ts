/**
 * Marca como "ya notificadas" (crea el `NotificacionEnvio` correspondiente, sin
 * mandar ningún email) las cargas de combustible que ya estaban `sospechoso: true`
 * antes de activar el resumen semanal (`combustible.cargaSospechosa`,
 * `frecuencia: 'semanal'` en el catálogo). Sin este backfill, la primera corrida
 * real del cron (`CombustibleCorreccionCronService.cronSemanal`) trataría a TODO
 * ese backlog histórico como "nuevo" y mandaría un email con cientos de tarjetas.
 *
 * Para no inflar de golpe la campana de notificaciones (`NotificacionesFeedService`,
 * que lee la misma tabla) para los admins actuales, cada fila backfilleada se crea
 * con `leidoPor` ya cargado con los userIds de los admins vigentes del tenant al
 * momento de correr esto — un admin nuevo que se sume después sí vería el backlog
 * como no leído, caso aceptado (no hay forma de saber "admins vigentes en el
 * pasado" sin este backfill).
 *
 * Idempotente: usa `skipDuplicates` sobre el mismo `@@unique([tenantId, tipo,
 * entidadId])` que ya usa el dedup real — correr de nuevo no duplica nada.
 *
 * Uso:
 *   npm run backfill:notif-carga-sospechosa:dry                    ← preview
 *   npm run backfill:notif-carga-sospechosa                        ← aplica
 *   npm run backfill:notif-carga-sospechosa -- --tenant-id org_xxx ← limita a un tenant
 */

import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const TIPO = 'combustible.cargaSospechosa';

const MOTIVO_LABEL: Record<string, string> = {
  litros_extremo: 'litros fuera de rango',
  importe_invalido: 'importe inválido',
  precio_litro_fuera_de_rango: 'precio por litro fuera de rango',
  km_delta_invalido: 'salto de kilometraje inválido',
  costo_km_invalido: 'costo por kilómetro fuera de rango',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantIdArg };
}

/**
 * Best-effort: si Clerk no responde (credencial de otro entorno, org no encontrada,
 * etc.) no aborta el backfill — sigue con `leidoPor: []`, aceptando que el backlog
 * aparezca como no leído en la campana esta única vez.
 */
async function adminUserIds(tenantId: string): Promise<string[]> {
  try {
    const ids: string[] = [];
    let offset = 0;
    const limit = 50;
    while (true) {
      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: tenantId,
        limit,
        offset,
      });
      for (const m of memberships.data) {
        if (m.role === 'org:admin' && m.publicUserData?.userId) {
          ids.push(m.publicUserData.userId);
        }
      }
      if (memberships.data.length < limit) break;
      offset += limit;
    }
    return ids;
  } catch (error) {
    console.warn(
      `  ⚠️  No se pudo consultar Clerk para ${tenantId} (¿CLERK_SECRET_KEY de otro entorno?) — leidoPor quedará vacío. ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function main() {
  const { isDryRun, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Backfill: marcar backlog de cargas sospechosas como notificado');
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

  for (const t of tenants) {
    const cargas = await prisma.cargaCombustible.findMany({
      where: { tenantId: t.clerkOrgId, sospechoso: true },
      select: {
        id: true,
        estacion: true,
        litros: true,
        importe: true,
        fecha: true,
        motivoSospecha: true,
        vehiculoId: true,
      },
    });
    if (cargas.length === 0) {
      console.log(`[${t.clerkOrgId}] sin cargas sospechosas — nada que hacer`);
      continue;
    }

    const existentes = await prisma.notificacionEnvio.findMany({
      where: {
        tenantId: t.clerkOrgId,
        tipo: TIPO,
        entidadId: { in: cargas.map((c) => c.id) },
      },
      select: { entidadId: true },
    });
    const yaMarcadas = new Set(existentes.map((e) => e.entidadId));
    const pendientes = cargas.filter((c) => !yaMarcadas.has(c.id));

    if (pendientes.length === 0) {
      console.log(`[${t.clerkOrgId}] ${cargas.length} sospechosas, ya todas marcadas — nada que hacer`);
      continue;
    }

    const vehiculoIds = [...new Set(pendientes.map((c) => c.vehiculoId).filter((v): v is string => !!v))];
    const vehiculos = vehiculoIds.length
      ? await prisma.vehiculo.findMany({
          where: { id: { in: vehiculoIds }, tenantId: t.clerkOrgId },
          select: { id: true, patente: true },
        })
      : [];
    const patentePorId = new Map(vehiculos.map((v) => [v.id, v.patente]));

    const admins = await adminUserIds(t.clerkOrgId);

    console.log(
      `[${t.clerkOrgId}] ${pendientes.length} cargas sospechosas sin marcar (de ${cargas.length} totales) — ` +
        `se marcan como leídas para ${admins.length} admin(s) actual(es)`,
    );

    if (!isDryRun) {
      await prisma.notificacionEnvio.createMany({
        data: pendientes.map((c) => ({
          tenantId: t.clerkOrgId,
          tipo: TIPO,
          entidadId: c.id,
          titulo: `Carga sospechosa — ${c.vehiculoId ? (patentePorId.get(c.vehiculoId) ?? 'vehículo') : 'vehículo sin datos'} en ${c.estacion}`,
          detalle: `${c.fecha.toLocaleDateString('es-AR')} · ${c.litros} L · $${c.importe.toLocaleString('es-AR')} · Motivo: ${MOTIVO_LABEL[c.motivoSospecha ?? ''] ?? c.motivoSospecha ?? 'sin especificar'}`,
          destinatarios: [],
          leidoPor: admins,
        })),
        skipDuplicates: true,
      });
    }
  }

  console.log(isDryRun ? '\n💡 Ejecutar sin --dry-run para aplicar.' : '\n✅ Backfill completado.');
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
