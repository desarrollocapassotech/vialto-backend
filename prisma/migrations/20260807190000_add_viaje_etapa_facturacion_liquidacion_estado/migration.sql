-- Rediseño de estados de Viaje: separa el `estado` combinado (etapa + facturación + cobro)
-- en 3 indicadores independientes. `estado` queda deprecado (no se escribe más) y se
-- elimina en una migración futura, siguiendo el mismo patrón incremental que las
-- migraciones 20260406140000/200000/210000_viaje_estado_*.
--
-- Aditivo e idempotente a propósito (ver nota de drift compartido en CLAUDE.md): esta
-- migración se aplicó también vía `prisma db execute` por drift preexistente no
-- relacionado (tabla "paises") en la base develop compartida; todos los pasos son
-- seguros de re-ejecutar.

ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "etapa" TEXT;
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "facturacionEstado" TEXT;
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "liquidacionEstado" TEXT;

-- etapa: colapsa las variantes "finalizado_*" / "cobrado" (incluidos legados) en "finalizado".
UPDATE "viajes" SET "etapa" = CASE
  WHEN "estado" IN ('pendiente', 'en_curso', 'cancelado') THEN "estado"
  ELSE 'finalizado'
END;

-- facturacionEstado, paso 1: viajes sin factura vinculada.
UPDATE "viajes" SET "facturacionEstado" = 'sin_facturar' WHERE "facturaId" IS NULL;

-- facturacionEstado, paso 2: viajes con factura vinculada. Los sub-estados de AFIP
-- (esperando/error/anulado) solo aplican si el tenant tiene integracion-arca activa —
-- si no, se ignora arcaEstado por completo (no debería tener nada seteado en operación
-- normal, pero por las dudas de datos de prueba o un módulo desactivado después).
UPDATE "viajes" v
SET "facturacionEstado" = CASE
  WHEN 'integracion-arca' = ANY(t."modules") AND f."arcaEstado" = 'pendiente_cae' THEN 'esperando_afip'
  WHEN 'integracion-arca' = ANY(t."modules") AND f."arcaEstado" = 'error' THEN 'error_afip'
  WHEN 'integracion-arca' = ANY(t."modules") AND f."arcaEstado" = 'anulado' THEN 'anulado'
  WHEN v."estado" = 'cobrado' THEN 'cobrado'
  ELSE 'facturado'
END
-- Nota: la tabla objetivo del UPDATE ("v") no puede referenciarse dentro de un JOIN..ON
-- de la cláusula FROM en Postgres (solo en SET/WHERE) — por eso el join a "tenants" usa
-- f."tenantId" (garantizado igual a v."tenantId" por la relación facturaId) en vez de
-- v."tenantId". Bug real detectado en el deploy a producción del 2026-08-10 (P3009):
-- "invalid reference to FROM-clause entry for table v".
FROM "facturas" f
JOIN "tenants" t ON t."clerkOrgId" = f."tenantId"
WHERE v."facturaId" = f."id";

-- facturacionEstado, paso 3: red de seguridad para facturaId huérfano (factura borrada).
UPDATE "viajes" SET "facturacionEstado" = 'sin_facturar'
WHERE "facturaId" IS NOT NULL
  AND "facturacionEstado" IS NULL;

-- liquidacionEstado: solo viajes con transportista externo Y tenant con integracion-arca
-- activa (un tenant sin el módulo nunca debe mostrar nada de AFIP, aunque tenga
-- liquidaciones colgadas de datos de prueba o de un módulo desactivado después). Toma la
-- liquidación más reciente (por updatedAt) entre las vinculadas al viaje; si no hay
-- ninguna, sin_liquidar.
-- Mismo bug de FROM/JOIN que arriba: "sub" ahora expone tenant_id (de la liquidación,
-- garantizado igual al tenantId del viaje) para poder joinear "tenants" sin referenciar "v".
UPDATE "viajes" v
SET "liquidacionEstado" = sub.mapped
FROM (
  SELECT DISTINCT ON (lv."viajeId") lv."viajeId" AS viaje_id, l."tenantId" AS tenant_id,
    CASE
      WHEN l."estado" IN ('borrador', 'pendiente_cae') THEN 'esperando_afip'
      WHEN l."estado" = 'autorizado' THEN 'liquidado'
      WHEN l."estado" = 'error' THEN 'error_afip'
      WHEN l."estado" = 'anulado' THEN 'anulado'
      ELSE 'sin_liquidar'
    END AS mapped
  FROM "liquidacion_viajes" lv
  JOIN "liquidaciones" l ON l."id" = lv."liquidacionId"
  ORDER BY lv."viajeId", l."updatedAt" DESC
) sub
JOIN "tenants" t ON t."clerkOrgId" = sub.tenant_id
WHERE v."id" = sub.viaje_id
  AND v."transportistaId" IS NOT NULL
  AND 'integracion-arca' = ANY(t."modules");

UPDATE "viajes" v SET "liquidacionEstado" = 'sin_liquidar'
FROM "tenants" t
WHERE t."clerkOrgId" = v."tenantId"
  AND v."transportistaId" IS NOT NULL
  AND 'integracion-arca' = ANY(t."modules")
  AND v."liquidacionEstado" IS NULL;

-- Endurecer: a partir de acá el código siempre escribe etapa/facturacionEstado.
ALTER TABLE "viajes" ALTER COLUMN "etapa" SET DEFAULT 'pendiente';
ALTER TABLE "viajes" ALTER COLUMN "etapa" SET NOT NULL;
ALTER TABLE "viajes" ALTER COLUMN "facturacionEstado" SET DEFAULT 'sin_facturar';
ALTER TABLE "viajes" ALTER COLUMN "facturacionEstado" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "viajes_tenantId_etapa_idx" ON "viajes"("tenantId", "etapa");
CREATE INDEX IF NOT EXISTS "viajes_tenantId_facturacionEstado_idx" ON "viajes"("tenantId", "facturacionEstado");
CREATE INDEX IF NOT EXISTS "viajes_tenantId_liquidacionEstado_idx" ON "viajes"("tenantId", "liquidacionEstado");
