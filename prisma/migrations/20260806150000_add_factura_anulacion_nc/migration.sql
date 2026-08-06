-- Anulación de Factura A/B vía Nota de Crédito (03/08): CAE NC + PDF Cloudinary
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionCbteTipo" INTEGER;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionCbteNro" INTEGER;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionPtoVenta" INTEGER;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionCae" TEXT;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionCaeFechaVto" TIMESTAMP(3);
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anulacionFecha" TIMESTAMP(3);
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "motivoAnulacion" TEXT;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anuladoPor" TEXT;
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "anuladoAt" TIMESTAMP(3);
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "notaCreditoUrl" TEXT;
