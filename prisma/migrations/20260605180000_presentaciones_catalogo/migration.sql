-- Catálogo de presentaciones por tenant (reemplaza presentaciones por producto).

DROP TABLE IF EXISTS "presentaciones";

CREATE TABLE "presentaciones" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "nombreNormalizado" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "presentaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "presentaciones_tenantId_nombreNormalizado_key"
  ON "presentaciones"("tenantId", "nombreNormalizado");
CREATE INDEX "presentaciones_tenantId_idx" ON "presentaciones"("tenantId");
CREATE INDEX "presentaciones_tenantId_activo_idx" ON "presentaciones"("tenantId", "activo");

ALTER TABLE "presentaciones"
  ADD CONSTRAINT "presentaciones_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "presentacion1Id" TEXT;
ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "presentacion2Id" TEXT;

-- Sembrar presentaciones desde nombres de unidad existentes en productos.
INSERT INTO "presentaciones" ("id", "tenantId", "nombre", "nombreNormalizado", "activo", "createdAt", "updatedAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  u."tenantId",
  u.nombre_display,
  u.nombre_norm,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (sub."tenantId", sub.nombre_norm)
    sub."tenantId",
    sub.nombre_norm,
    sub.nombre_display
  FROM (
    SELECT
      p."tenantId",
      lower(trim(regexp_replace(p."unidad1Nombre", '\s+', ' ', 'g'))) AS nombre_norm,
      trim(regexp_replace(p."unidad1Nombre", '\s+', ' ', 'g')) AS nombre_display
    FROM "productos" p
    WHERE trim(p."unidad1Nombre") <> ''
    UNION
    SELECT
      p."tenantId",
      lower(trim(regexp_replace(p."unidad2Nombre", '\s+', ' ', 'g'))),
      trim(regexp_replace(p."unidad2Nombre", '\s+', ' ', 'g'))
    FROM "productos" p
    WHERE p."unidad2Nombre" IS NOT NULL AND trim(p."unidad2Nombre") <> ''
  ) sub
  WHERE sub.nombre_norm <> ''
  ORDER BY sub."tenantId", sub.nombre_norm, sub.nombre_display
) u;

-- Vincular productos a presentaciones de cantidad 1.
UPDATE "productos" p
SET "presentacion1Id" = pr."id"
FROM "presentaciones" pr
WHERE pr."tenantId" = p."tenantId"
  AND pr."nombreNormalizado" = lower(trim(regexp_replace(p."unidad1Nombre", '\s+', ' ', 'g')));

-- Vincular productos a presentaciones de cantidad 2.
UPDATE "productos" p
SET "presentacion2Id" = pr."id"
FROM "presentaciones" pr
WHERE p."unidad2Nombre" IS NOT NULL
  AND trim(p."unidad2Nombre") <> ''
  AND pr."tenantId" = p."tenantId"
  AND pr."nombreNormalizado" = lower(trim(regexp_replace(p."unidad2Nombre", '\s+', ' ', 'g')));

-- Presentación por defecto para productos sin match (Pallets).
INSERT INTO "presentaciones" ("id", "tenantId", "nombre", "nombreNormalizado", "activo", "createdAt", "updatedAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  t."clerkOrgId",
  'Pallets',
  'pallets',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE EXISTS (SELECT 1 FROM "productos" p WHERE p."tenantId" = t."clerkOrgId" AND p."presentacion1Id" IS NULL)
ON CONFLICT ("tenantId", "nombreNormalizado") DO NOTHING;

UPDATE "productos" p
SET "presentacion1Id" = pr."id"
FROM "presentaciones" pr
WHERE p."presentacion1Id" IS NULL
  AND pr."tenantId" = p."tenantId"
  AND pr."nombreNormalizado" = 'pallets';

ALTER TABLE "productos"
  ADD CONSTRAINT "productos_presentacion1Id_fkey"
  FOREIGN KEY ("presentacion1Id") REFERENCES "presentaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "productos"
  ADD CONSTRAINT "productos_presentacion2Id_fkey"
  FOREIGN KEY ("presentacion2Id") REFERENCES "presentaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
