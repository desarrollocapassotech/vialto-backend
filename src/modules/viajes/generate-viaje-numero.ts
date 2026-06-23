import type { PrismaClient } from '@prisma/client';

/**
 * Número correlativo por tenant y año: 2026-000001, 2026-000002, …
 * Usa el máximo existente + 1 (no count) para evitar colisiones si hay huecos o números manuales.
 */
export async function generateNumeroViaje(
  prisma: Pick<PrismaClient, 'viaje'>,
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;

  const latest = await prisma.viaje.findFirst({
    where: { tenantId, numero: { startsWith: prefix } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  let next = 1;
  if (latest?.numero) {
    const suffix = latest.numero.slice(prefix.length);
    const parsed = parseInt(suffix, 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  return `${prefix}${String(next).padStart(6, '0')}`;
}
