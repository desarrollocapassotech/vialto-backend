import type { PrismaClient } from '@prisma/client';

/**
 * Número correlativo por tenant y año: 2026-000001, 2026-000002, …
 */
export async function generateNumeroViaje(
  prisma: Pick<PrismaClient, 'viaje'>,
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const count = await prisma.viaje.count({
    where: { tenantId, numero: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(6, '0')}`;
}
