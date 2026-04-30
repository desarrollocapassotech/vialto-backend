-- Catálogo de tipos de carga (viajes) + vínculo opcional en viajes.
-- Datos: deduplica textos históricos de detalleCarga por tenant y nombre normalizado.

CREATE TABLE "tipos_carga" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombreNormalizado" TEXT NOT NULL,
    "descripcion" TEXT,
    "unidadMedida" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_carga_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tipos_carga_tenantId_nombreNormalizado_key" ON "tipos_carga"("tenantId", "nombreNormalizado");
CREATE INDEX "tipos_carga_tenantId_idx" ON "tipos_carga"("tenantId");
CREATE INDEX "tipos_carga_tenantId_activo_idx" ON "tipos_carga"("tenantId", "activo");

ALTER TABLE "tipos_carga" ADD CONSTRAINT "tipos_carga_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "viajes" ADD COLUMN "tipoCargaId" TEXT;

ALTER TABLE "viajes" ADD CONSTRAINT "viajes_tipoCargaId_fkey" FOREIGN KEY ("tipoCargaId") REFERENCES "tipos_carga"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "viajes_tenantId_tipoCargaId_idx" ON "viajes"("tenantId", "tipoCargaId");

-- Poblar catálogo desde detalleCarga existente (dedupe por tenant + nombre normalizado).
WITH src AS (
  SELECT
    v."tenantId",
    lower(regexp_replace(trim(v."detalleCarga"), E'\\s+', ' ', 'g')) AS norm,
    regexp_replace(trim(v."detalleCarga"), E'\\s+', ' ', 'g') AS nombre_trim,
    v."createdAt"
  FROM "viajes" v
  WHERE v."detalleCarga" IS NOT NULL AND trim(v."detalleCarga") <> ''
),
chosen AS (
  SELECT DISTINCT ON ("tenantId", norm)
    "tenantId",
    norm,
    nombre_trim AS nombre
  FROM src
  WHERE length(norm) > 0
  ORDER BY "tenantId", norm, "createdAt" ASC
)
INSERT INTO "tipos_carga" ("id", "tenantId", "nombre", "nombreNormalizado", "descripcion", "unidadMedida", "activo", "metadata", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || random()::text),
  "tenantId",
  nombre,
  norm,
  NULL,
  NULL,
  true,
  '{}',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM chosen;

UPDATE "viajes" v
SET "tipoCargaId" = t."id"
FROM "tipos_carga" t
WHERE v."tenantId" = t."tenantId"
  AND v."detalleCarga" IS NOT NULL
  AND trim(v."detalleCarga") <> ''
  AND t."nombreNormalizado" = lower(regexp_replace(trim(v."detalleCarga"), E'\\s+', ' ', 'g'));
