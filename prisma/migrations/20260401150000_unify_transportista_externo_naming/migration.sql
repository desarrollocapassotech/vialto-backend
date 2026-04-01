ALTER TABLE "viajes"
RENAME COLUMN "precioFletero" TO "precioTransportistaExterno";

UPDATE "facturas"
SET "tipo" = 'transportista_externo'
WHERE "tipo" = 'fletero';
