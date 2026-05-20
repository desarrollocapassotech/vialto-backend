import { PrismaClient } from '@prisma/client';

const TARGET = process.argv[2]?.trim() ?? 'org_3C8Ta9DA8tyhEAurhIM54KHWwSk';

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({
      select: { clerkOrgId: true, name: true, modules: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log('--- Tenants ---');
    for (const t of tenants) {
      const [clientes, viajes, choferes] = await Promise.all([
        prisma.cliente.count({ where: { tenantId: t.clerkOrgId } }),
        prisma.viaje.count({ where: { tenantId: t.clerkOrgId } }),
        prisma.chofer.count({ where: { tenantId: t.clerkOrgId } }),
      ]);
      console.log({
        clerkOrgId: t.clerkOrgId,
        name: t.name,
        clientes,
        viajes,
        choferes,
        matchTarget: t.clerkOrgId === TARGET,
      });
    }
    const totals = {
      clientes: await prisma.cliente.count(),
      viajes: await prisma.viaje.count(),
      choferes: await prisma.chofer.count(),
      transportistas: await prisma.transportista.count(),
      vehiculos: await prisma.vehiculo.count(),
    };
    console.log('\n--- Totales globales en esta DB ---');
    console.log(totals);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
