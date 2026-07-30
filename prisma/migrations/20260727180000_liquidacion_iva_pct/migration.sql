-- Alicuota de IVA por liquidacion (snapshot al crear/editar).
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "ivaPct" DOUBLE PRECISION NOT NULL DEFAULT 21;

-- Backfill con la alicuota configurada del tenant cuando exista.
UPDATE "liquidaciones" AS l
SET "ivaPct" = COALESCE(ac."ivaGastosAdmin", 21)
FROM "arca_configs" AS ac
WHERE ac."tenantId" = l."tenantId";
