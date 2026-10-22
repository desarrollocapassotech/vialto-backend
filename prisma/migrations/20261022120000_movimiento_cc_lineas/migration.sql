-- Ventas/compras manuales de cuenta corriente cargadas por líneas (importe neto + IVA % por línea).
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN IF NOT EXISTS "lineas" JSONB;
