import type { ClerkVialtoRoleService } from '../../core/auth/clerk-vialto-role.service';

/**
 * Resuelve Clerk userId → nombre legible para UI (campo virtual `anuladoPorNombre`,
 * no se persiste). Usado por Factura y Liquidacion — mismo criterio en los dos.
 */
export async function attachAnuladoPorNombres<T>(
  clerkUsers: ClerkVialtoRoleService,
  rows: T[],
): Promise<Array<T & { anuladoPorNombre: string | null }>> {
  const getAnuladoPor = (r: T) =>
    (r as { anuladoPor?: string | null }).anuladoPor?.trim() || null;
  const ids = [
    ...new Set(rows.map(getAnuladoPor).filter((id): id is string => Boolean(id))),
  ];
  const labels = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (id) => {
      if (id.startsWith('user_')) {
        labels.set(id, await clerkUsers.getUserDisplayLabel(id));
      } else {
        // Ya era un label persistido o valor no-Clerk
        labels.set(id, id);
      }
    }),
  );
  return rows.map((r) => {
    const id = getAnuladoPor(r);
    const nombre = id ? labels.get(id) || id : null;
    return { ...r, anuladoPorNombre: nombre };
  });
}
