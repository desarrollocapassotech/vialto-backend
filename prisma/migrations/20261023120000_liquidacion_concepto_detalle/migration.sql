-- Aclaración libre opcional por concepto de liquidación (ej. "Faltante del viaje 10135713752").
ALTER TABLE "liquidacion_concepto_lineas" ADD COLUMN IF NOT EXISTS "detalle" TEXT;
