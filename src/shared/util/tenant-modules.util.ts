/** Slugs de módulo que habilitan la facturación a clientes (manual o ARCA). */
export const MODULOS_FACTURACION = [
  "facturacion",
  "emision-facturas-arca",
] as const;

/** Comparación case-insensitive de módulos habilitados en `Tenant.modules`. */
export function tieneAlgunModulo(
  modules: readonly string[] | null | undefined,
  requeridos: readonly string[],
): boolean {
  if (!modules?.length || !requeridos.length) return false;
  const normalizados = new Set(modules.map((m) => m.toLowerCase()));
  return requeridos.some((r) => normalizados.has(r.toLowerCase()));
}

/** Resuelve en una sola pasada si la empresa tiene Facturación (manual o ARCA). */
export function resolverModulosFacturacion(
  modules: readonly string[] | null | undefined,
): { tieneFacturacion: boolean; tieneArca: boolean } {
  const tieneArca = tieneAlgunModulo(modules, ["emision-facturas-arca"]);
  const tieneFacturacion = tieneArca || tieneAlgunModulo(modules, ["facturacion"]);
  return { tieneFacturacion, tieneArca };
}
