-- Moneda de los montos (facturación y precio transportista externo).
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "monedaMonto" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "monedaPrecioTransportistaExterno" TEXT NOT NULL DEFAULT 'ARS';
