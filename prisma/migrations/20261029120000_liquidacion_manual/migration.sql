-- Liquidación manual (sin emisión ARCA) en empresas con Líquido Producto: transportistas monotributistas.
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "manual" BOOLEAN NOT NULL DEFAULT false;
