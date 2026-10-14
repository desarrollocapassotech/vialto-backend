-- Detalle de IVA en ventas/compras manuales de cuenta corriente. `importe` sigue siendo el total.
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN "importeNeto" DOUBLE PRECISION;
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN "ivaPct" DOUBLE PRECISION;
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN "ivaMonto" DOUBLE PRECISION;
