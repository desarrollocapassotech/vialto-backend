-- Ganancia bruta manual cuando facturación y pago al transportista usan monedas distintas
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "gananciaBrutaManual" FLOAT;
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "monedaGananciaBrutaManual" TEXT;
