/** Nombres de módulos vendibles (deben coincidir con `Tenant.modules` y RequireModule). */
export const VIALTO_MODULES = [
  'viajes',
  'facturacion',
  'cuenta-corriente',
  'stock',
  'combustible',
  'mantenimiento',
  'remitos',
  'turnos',
  'reportes',
] as const;

export type VialtoModuleName = (typeof VIALTO_MODULES)[number];
