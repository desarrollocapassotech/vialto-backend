-- Documento aduanero MIC/CRT separado de datos operativos del viaje
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "documentoAduanero" JSONB NOT NULL DEFAULT '{}';
