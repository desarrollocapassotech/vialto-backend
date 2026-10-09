ALTER TABLE "liquidacion_concepto_lineas" ADD COLUMN IF NOT EXISTS "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "liquidacion_concepto_lineas" ADD COLUMN IF NOT EXISTS "montoUnitario" DOUBLE PRECISION;
