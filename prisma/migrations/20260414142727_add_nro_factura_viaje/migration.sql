-- DropIndex
DROP INDEX "viajes_facturaId_idx";

-- AlterTable
ALTER TABLE "viajes" ADD COLUMN     "nroFactura" TEXT;
