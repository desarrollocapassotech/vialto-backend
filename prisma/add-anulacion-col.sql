-- Agrega la columna anulacionTipoComprobante a arca_configs SIN pasar por `migrate dev`.
-- Motivo: la historia de migraciones está desincronizada por una migración de otra
-- rama aplicada a la base compartida (no es un problema de esta columna).
-- Es aditivo e idempotente: se puede correr más de una vez sin riesgo ni pérdida de datos.
ALTER TABLE "arca_configs"
  ADD COLUMN IF NOT EXISTS "anulacionTipoComprobante" TEXT NOT NULL DEFAULT 'nota_credito';
