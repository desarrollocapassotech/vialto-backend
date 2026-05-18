-- gastosAdminPorViaje se mueve al metadata de cada viaje; ya no es un parámetro global.
ALTER TABLE "arca_configs" DROP COLUMN IF EXISTS "gastosAdminPorViaje";

-- Snapshot del gasto admin por viaje en la liquidación.
ALTER TABLE "liquidacion_viajes" ADD COLUMN IF NOT EXISTS "gastosAdmin" DOUBLE PRECISION;
