-- Color de acento de los PDF de factura y de liquidación (hex "#RRGGBB"). Opcional, por
-- empresa: NULL = el diseño de siempre en blanco y negro.
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "colorFactura" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "colorLiquidacion" TEXT;
