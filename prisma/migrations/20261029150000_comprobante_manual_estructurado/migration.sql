ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "manualCbteTipo" INTEGER;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "manualPtoVenta" INTEGER;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "manualCbteNro" INTEGER;

ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "proveedorCbteTipo" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "proveedorPtoVenta" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "proveedorCbteNro" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "proveedorCbteFecha" TIMESTAMP(3);
