/**
 * Tipos de proveedor (tabla `transportistas`, nov 2026). Espejo en el front:
 * `vialto-frontend/src/lib/proveedorTipo.ts`.
 *
 * - `transportista`: único tipo que se ofrece en Viajes, Liquidaciones, Choferes y Vehículos.
 * - `taller`: único tipo que se ofrece en las órdenes de trabajo de Mantenimiento.
 * - `otro`: cualquier otro proveedor (solo Cuenta corriente).
 */
export const PROVEEDOR_TIPOS = ['transportista', 'taller', 'otro'] as const;
export type ProveedorTipo = (typeof PROVEEDOR_TIPOS)[number];

export const PROVEEDOR_TIPO_LABEL: Record<ProveedorTipo, string> = {
  transportista: 'Transportista',
  taller: 'Taller',
  otro: 'Otro',
};

export function esProveedorTipo(v: unknown): v is ProveedorTipo {
  return typeof v === 'string' && (PROVEEDOR_TIPOS as readonly string[]).includes(v);
}

/** Filtro Prisma para los proveedores que pueden hacer un flete. */
export const WHERE_SOLO_TRANSPORTISTAS = { tipo: 'transportista' } as const;
