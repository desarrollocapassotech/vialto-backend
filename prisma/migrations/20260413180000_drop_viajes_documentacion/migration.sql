-- Drop unused viajes.documentacion (String[])
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "documentacion";
