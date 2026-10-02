-- Tipo de flota por empresa (mixta | propia | externa), configurable desde superadmin.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tipoFlota" TEXT NOT NULL DEFAULT 'mixta';

-- Conserva lo ya configurado con las opciones de pertenencia del chofer
-- ("flotaPropia" / "transportistaExterno" en tenant_field_configs, módulo
-- 'choferes'), que dejan de existir en el catálogo de campos. Misma prioridad
-- que TenantFieldConfigService.getOverrides: primero la fila compartida
-- ('viajes_compartidos'), después las filas legadas por formulario.
WITH flags AS (
  SELECT
    t."clerkOrgId" AS tenant_id,
    COALESCE(
      (SELECT (c."campos"->'flotaPropia'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'viajes_compartidos'),
      (SELECT (c."campos"->'flotaPropia'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'alta_chofer'),
      (SELECT (c."campos"->'flotaPropia'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'edicion_chofer'),
      true
    ) AS propia,
    COALESCE(
      (SELECT (c."campos"->'transportistaExterno'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'viajes_compartidos'),
      (SELECT (c."campos"->'transportistaExterno'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'alta_chofer'),
      (SELECT (c."campos"->'transportistaExterno'->>'visible')::boolean FROM "tenant_field_configs" c
        WHERE c."tenantId" = t."clerkOrgId" AND c."modulo" = 'choferes' AND c."formulario" = 'edicion_chofer'),
      true
    ) AS externa
  FROM "tenants" t
)
UPDATE "tenants" t
SET "tipoFlota" = CASE
  WHEN f.propia AND NOT f.externa THEN 'propia'
  WHEN f.externa AND NOT f.propia THEN 'externa'
  ELSE 'mixta'
END
FROM flags f
WHERE f.tenant_id = t."clerkOrgId";
