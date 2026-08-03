-- Persistencia de la Nota de Crédito 065 emitida al anular un CVLP autorizado.
-- El CVLP original (cbteTipo/cbteNro/cae) se conserva para el PDF histórico.

ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionCbteTipo" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionCbteNro" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionPtoVenta" INTEGER;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionCae" TEXT;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionCaeFechaVto" TIMESTAMP(3);
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "anulacionFecha" TIMESTAMP(3);
