-- pais reemplaza a bandera (mismo concepto). Se agrega condicionTributaria para países no AR.
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "condicionTributaria" TEXT;
ALTER TABLE "transportistas" DROP COLUMN IF EXISTS "bandera";
