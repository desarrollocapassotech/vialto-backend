-- Restaura columnas de auditoría de anulación (VTO-130).
-- Habían sido dadas de alta en 20260727160000 y luego eliminadas como
-- "huérfanas" en 20260730190000 antes de mergear esta rama.
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "motivoAnulacion" TEXT;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anuladoPor" TEXT;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anuladoAt" TIMESTAMP(3);