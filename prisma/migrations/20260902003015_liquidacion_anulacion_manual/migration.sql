-- Método de anulación del CVLP (060), configurable solo desde superadmin (panel Empresas).
-- 'nota_credito_debito' (default, comportamiento histórico) | 'manual' (sin emisión a ARCA).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "liquidacionAnulacionMetodo" TEXT NOT NULL DEFAULT 'nota_credito_debito';

-- Estado intermedio "pendiente_anulacion" (método manual) + auditoría del comprobante
-- pre-impreso adjunto por el usuario. anulacionCbte*/anulacionCae* existentes siguen
-- usándose solo por el método 'nota_credito_debito'.
ALTER TABLE "liquidaciones"
  ADD COLUMN IF NOT EXISTS "anulacionMetodo" TEXT,
  ADD COLUMN IF NOT EXISTS "anulacionPendienteDesde" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anulacionPendientePor" TEXT,
  ADD COLUMN IF NOT EXISTS "anulacionManualComprobanteUrl" TEXT;
