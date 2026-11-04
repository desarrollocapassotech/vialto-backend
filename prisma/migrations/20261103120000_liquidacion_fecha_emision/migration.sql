-- Fecha de emisión del CVLP elegida por el usuario al emitir (medianoche UTC).
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "fechaEmision" TIMESTAMP(3);
