-- Backfill nro_factura para viajes que ya tienen facturaId asignado
UPDATE "viajes"
SET "nroFactura" = facturas.numero
FROM "facturas"
WHERE "viajes"."facturaId" = facturas.id
  AND "viajes"."nroFactura" IS NULL;
