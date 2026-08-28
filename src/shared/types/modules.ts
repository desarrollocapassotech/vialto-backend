/** Nombres de módulos vendibles (deben coincidir con `Tenant.modules` y RequireModule). */
export const VIALTO_MODULES = [
  'viajes',
  'facturacion',
  'cuenta-corriente',
  'stock',
  'combustible',
  'mantenimiento',
  'emision-facturas-arca',
  'emision-liquido-producto-arca',
] as const;

export type VialtoModuleName = (typeof VIALTO_MODULES)[number];
