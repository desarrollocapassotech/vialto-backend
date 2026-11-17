-- IVA por tramo en el pago al transportista (pedido LSF).
-- Json [{ detalle, monto, ivaPct }]. Vacio = calculo de siempre. Aditivo e idempotente.
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "tramosTransportista" JSONB NOT NULL DEFAULT '[]';
