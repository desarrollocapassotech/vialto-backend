-- Documentos adjuntos del viaje (hasta 3, 10 MB en total; ver ViajesService.addAdjunto).
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "adjuntos" JSONB NOT NULL DEFAULT '[]';
