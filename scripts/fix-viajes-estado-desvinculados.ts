/**
 * Script temporal — ejecutar una sola vez.
 *
 * Corrige viajes que quedaron en estado 'facturado_sin_cobrar'
 * sin estar vinculados a ninguna factura (facturaId = null).
 * Los revierte a 'finalizado_sin_facturar'.
 *
 * Uso:
 *   npx ts-node -e "require('dotenv').config()" scripts/fix-viajes-estado-desvinculados.ts
 *   o directamente si DATABASE_URL ya está en el entorno:
 *   npx ts-node scripts/fix-viajes-estado-desvinculados.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const afectados = await prisma.viaje.findMany({
    where: { estado: 'facturado_sin_cobrar', facturaId: null },
    select: { id: true, tenantId: true, numero: true },
  });

  console.log(`Viajes a corregir: ${afectados.length}`);
  if (afectados.length === 0) {
    console.log('Nada que hacer.');
    return;
  }

  for (const v of afectados) {
    console.log(`  [${v.tenantId}] ${v.numero} (${v.id})`);
  }

  const result = await prisma.viaje.updateMany({
    where: { estado: 'facturado_sin_cobrar', facturaId: null },
    data: { estado: 'finalizado_sin_facturar' },
  });

  console.log(`\nActualizados: ${result.count} viajes → 'finalizado_sin_facturar'`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
