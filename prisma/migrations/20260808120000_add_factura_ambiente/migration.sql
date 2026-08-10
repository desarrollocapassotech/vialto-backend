-- Ambiente ARCA (homologacion | produccion) con el que se autorizó la factura — snapshot,
-- igual que Liquidacion.ambiente. Nulo para facturas sin ARCA o emitidas antes de este campo.
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "ambiente" TEXT;
