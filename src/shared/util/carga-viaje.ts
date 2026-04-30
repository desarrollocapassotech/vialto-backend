import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type DbCarga = Pick<Prisma.TransactionClient, 'carga'>;

/** Unicidad case-insensitive: trim, colapsar espacios internos, minúsculas. */
export function normalizarNombreCarga(nombre: string): string {
  const t = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  return t.toLowerCase();
}

export function nombreCargaDisplay(nombre: string): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ');
}

/** IDs únicos en orden de aparición (trim, sin vacíos). */
export function normalizarCargaIds(raw: string[] | undefined | null): string[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    const s = String(id ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function assertCargasAsignables(
  db: DbCarga,
  tenantId: string,
  cargaIds: string[],
  ctx: { modo: 'create' | 'update'; currentCargaIds?: ReadonlySet<string> },
): Promise<void> {
  if (cargaIds.length === 0) return;
  const rows = await db.carga.findMany({
    where: { tenantId, id: { in: cargaIds } },
    select: { id: true, activo: true },
  });
  if (rows.length !== cargaIds.length) {
    throw new BadRequestException('Alguna carga no existe o no pertenece a esta empresa.');
  }
  const current = ctx.currentCargaIds ?? new Set<string>();
  for (const row of rows) {
    if (!row.activo) {
      const conserva = ctx.modo === 'update' && current.has(row.id);
      if (ctx.modo === 'create' || !conserva) {
        throw new BadRequestException(
          'Esa carga está inactiva. Elegí otra del catálogo o reactivála desde Cargas.',
        );
      }
    }
  }
}
