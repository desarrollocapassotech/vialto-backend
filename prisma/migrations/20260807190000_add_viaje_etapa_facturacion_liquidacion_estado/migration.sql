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

-- facturacionEstado, paso 2: viajes con factura vinculada, según arcaEstado
-- (null = tenant sin integracion-arca) y el `estado` combinado viejo para distinguir cobrado.
UPDATE "viajes" v
SET "facturacionEstado" = CASE
  WHEN f."arcaEstado" = 'pendiente_cae' THEN 'esperando_afip'
  WHEN f."arcaEstado" = 'error' THEN 'error_afip'
  WHEN f."arcaEstado" = 'anulado' THEN 'anulado'
  WHEN v."estado" = 'cobrado' THEN 'cobrado'
  ELSE 'facturado'
END
FROM "facturas" f
WHERE v."facturaId" = f."id";

-- facturacionEstado, paso 3: red de seguridad para facturaId huérfano (factura borrada).
UPDATE "viajes" SET "facturacionEstado" = 'sin_facturar'
WHERE "facturaId" IS NOT NULL
  AND "facturacionEstado" IS NULL;

-- liquidacionEstado: solo viajes con transportista externo. Toma la liquidación más
-- reciente (por updatedAt) entre las vinculadas al viaje; si no hay ninguna, sin_liquidar.
UPDATE "viajes" v
SET "liquidacionEstado" = sub.mapped
FROM (
  SELECT DISTINCT ON (lv."viajeId") lv."viajeId" AS viaje_id,
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
WHERE v."id" = sub.viaje_id AND v."transportistaId" IS NOT NULL;

UPDATE "viajes" SET "liquidacionEstado" = 'sin_liquidar'
WHERE "transportistaId" IS NOT NULL AND "liquidacionEstado" IS NULL;

-- Endurecer: a partir de acá el código siempre escribe etapa/facturacionEstado.
ALTER TABLE "viajes" ALTER COLUMN "etapa" SET DEFAULT 'pendiente';
ALTER TABLE "viajes" ALTER COLUMN "etapa" SET NOT NULL;
ALTER TABLE "viajes" ALTER COLUMN "facturacionEstado" SET DEFAULT 'sin_facturar';
ALTER TABLE "viajes" ALTER COLUMN "facturacionEstado" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "viajes_tenantId_etapa_idx" ON "viajes"("tenantId", "etapa");
CREATE INDEX IF NOT EXISTS "viajes_tenantId_facturacionEstado_idx" ON "viajes"("tenantId", "facturacionEstado");
CREATE INDEX IF NOT EXISTS "viajes_tenantId_liquidacionEstado_idx" ON "viajes"("tenantId", "liquidacionEstado");
