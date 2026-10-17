-- Leyenda libre que se imprime en letra chica debajo de la condición de venta del PDF de
-- factura (ej. intereses por mora). Opcional, por empresa.
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "leyendaFactura" TEXT;
