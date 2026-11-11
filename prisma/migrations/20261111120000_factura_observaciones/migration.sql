-- Observaciones de la factura (pedido NyM, nov 2026): renglones de texto sin importe que se
-- imprimen en el PDF debajo de los viajes. Solo de la factura, no del viaje ni de la liquidación.
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "observaciones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
