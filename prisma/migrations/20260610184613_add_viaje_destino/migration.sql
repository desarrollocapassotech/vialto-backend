-- AlterTable
ALTER TABLE "facturas" ADD COLUMN     "comprobanteUrl" TEXT,
ADD COLUMN     "ivaPct" DOUBLE PRECISION DEFAULT 21;

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "comprobanteUrl" TEXT;
