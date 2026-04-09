-- Una factura puede tener múltiples viajes.
-- Movemos el FK de facturas.viajeId → viajes.facturaId

-- 1. Agregar facturaId a viajes
ALTER TABLE "viajes" ADD COLUMN "facturaId" TEXT;

-- 2. Migrar datos existentes: si una factura tenía viajeId, vincular ese viaje
UPDATE "viajes" v
SET "facturaId" = f."id"
FROM "facturas" f
WHERE f."viajeId" = v."id";

-- 3. FK constraint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_facturaId_fkey"
  FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Índice
CREATE INDEX "viajes_facturaId_idx" ON "viajes"("facturaId");

-- 5. Eliminar viajeId de facturas
ALTER TABLE "facturas" DROP COLUMN "viajeId";
