-- Antes de borrar precioCliente, copiar a monto a facturar si hacía falta.
UPDATE "viajes" SET "monto" = "precioCliente" WHERE "monto" IS NULL AND "precioCliente" IS NOT NULL;

ALTER TABLE "viajes" DROP COLUMN IF EXISTS "precioCliente";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "gananciaBruta";
