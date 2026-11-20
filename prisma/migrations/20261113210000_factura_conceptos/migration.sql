-- Conceptos que se suman a la factura ademas de los viajes (estadia, gastos del viaje...).
-- Json [{ descripcion, importe, ivaPct }]. Aditivo e idempotente.
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "conceptos" JSONB NOT NULL DEFAULT '[]';
