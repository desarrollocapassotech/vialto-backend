-- AlterTable (idempotente: ivaPct ya existe en prod, se usa IF NOT EXISTS)
ALTER TABLE "facturas"
  ADD COLUMN IF NOT EXISTS "comprobanteUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "ivaPct" DOUBLE PRECISION DEFAULT 21;

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "comprobanteUrl" TEXT;
