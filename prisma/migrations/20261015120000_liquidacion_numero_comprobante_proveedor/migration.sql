-- N° de la factura del proveedor en liquidaciones sin ARCA (se muestra en Cuenta corriente).
ALTER TABLE "liquidaciones" ADD COLUMN "numeroComprobanteProveedor" TEXT;
