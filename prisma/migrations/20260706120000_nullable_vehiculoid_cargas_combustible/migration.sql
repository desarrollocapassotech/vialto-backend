-- Make vehiculoId nullable in cargas_combustible with ON DELETE SET NULL
-- Allows deleting a vehicle that has associated cargas (vehiculoId becomes NULL instead of blocking)

ALTER TABLE "cargas_combustible" DROP CONSTRAINT IF EXISTS "CargaCombustible_vehiculoId_fkey";
ALTER TABLE "cargas_combustible" DROP CONSTRAINT IF EXISTS "cargas_combustible_vehiculoId_fkey";

ALTER TABLE "cargas_combustible" ALTER COLUMN "vehiculoId" DROP NOT NULL;

ALTER TABLE "cargas_combustible" ADD CONSTRAINT "cargas_combustible_vehiculoId_fkey"
  FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
