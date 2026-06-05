/**
 * Registra una org de Clerk en la tabla `Tenant` (útil si el front da 403/404).
 *
 * Uso:
 *   npx ts-node scripts/ensure-tenant.ts org_3C8Ta9DA8tyhEAurhIM54KHWwSk
 *   npx ts-node scripts/ensure-tenant.ts org_xxx "Nombre Empresa"
 */
import { PrismaClient } from '@prisma/client';

const DEFAULT_PRESENTACIONES = ['Pallet', 'Unidad'] as const;

function normalizarNombrePresentacion(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const VIALTO_MODULES = [
  'viajes',
  'facturacion',
  'cuenta-corriente',
  'stock',
  'combustible',
  'mantenimiento',
  'remitos',
  'liquidaciones-arca',
  'turnos',
  'reportes',
];

async function main() {
  const clerkOrgId = process.argv[2]?.trim();
  const nameArg = process.argv[3]?.trim();
  if (!clerkOrgId) {
    console.error('Uso: npx ts-node scripts/ensure-tenant.ts <clerkOrgId> [nombre]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.tenant.findUnique({ where: { clerkOrgId } });
    if (existing) {
      console.log('Tenant ya existe:', existing);
      return;
    }
    const tenant = await prisma.tenant.create({
      data: {
        clerkOrgId,
        name: nameArg || clerkOrgId,
        modules: VIALTO_MODULES,
        maxUsers: 10,
        billingStatus: 'trial',
      },
    });
    await prisma.presentacion.createMany({
      data: DEFAULT_PRESENTACIONES.map((nombre) => ({
        tenantId: tenant.clerkOrgId,
        nombre,
        nombreNormalizado: normalizarNombrePresentacion(nombre),
        activo: true,
      })),
      skipDuplicates: true,
    });
    console.log('Tenant creado:', tenant);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
