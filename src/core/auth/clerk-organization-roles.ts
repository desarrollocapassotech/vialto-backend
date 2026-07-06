/** Roles de tenant persistidos en `publicMetadata.vialtoRole` (fuente de verdad en Vialto). */
export const VIALTO_TENANT_ROLES = ['admin', 'member', 'stock_viewer'] as const;
export type VialtoTenantRole = (typeof VIALTO_TENANT_ROLES)[number];

/** Clerk solo expone org:admin y org:member sin add-on; roles custom van en metadata. */
export function toClerkOrganizationRole(appRole: string): string {
  if (appRole === 'admin') return 'org:admin';
  return 'org:member';
}

export function toVialtoRole(appRole: string): string {
  if (appRole === 'admin') return 'admin';
  if (appRole === 'stock_viewer') return 'stock_viewer';
  return 'member';
}

export function isVialtoTenantRole(value: string | undefined | null): value is VialtoTenantRole {
  return value != null && (VIALTO_TENANT_ROLES as readonly string[]).includes(value);
}

/** Prioridad: metadata Vialto → rol de organización Clerk normalizado. */
export function resolveAuthRole(
  vialtoRole: string | undefined | null,
  orgRoleClaim: string | undefined,
): string | null {
  if (vialtoRole === 'superadmin') return 'superadmin';
  if (isVialtoTenantRole(vialtoRole)) return vialtoRole;
  if (!orgRoleClaim) return null;
  if (orgRoleClaim === 'org:admin') return 'admin';
  if (orgRoleClaim === 'org:member') return 'member';
  return orgRoleClaim.replace(/^org:/, '');
}

/** Rol en formato Clerk para listados de UI (`org:admin`, `org:member`, `org:stock_viewer`). */
export function toDisplayOrgRole(vialtoRole: string): string {
  if (vialtoRole === 'admin') return 'org:admin';
  if (vialtoRole === 'stock_viewer') return 'org:stock_viewer';
  return 'org:member';
}
