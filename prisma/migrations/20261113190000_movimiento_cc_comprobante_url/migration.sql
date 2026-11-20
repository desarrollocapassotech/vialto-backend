-- Archivo adjunto de una venta/compra/cobro/pago manual de Cuenta corriente (factura,
-- recibo, orden de pago). Facturas y liquidaciones siguen guardando el suyo en su tabla.
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN IF NOT EXISTS "comprobanteUrl" TEXT;
