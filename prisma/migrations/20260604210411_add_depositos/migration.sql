-- DropIndex
DROP INDEX "movimientos_stock_depositoId_idx";

-- DropIndex
DROP INDEX "stock_items_depositoId_idx";

-- AlterTable
ALTER TABLE "depositos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_depositoId_idx" ON "movimientos_stock"("tenantId", "depositoId");

-- CreateIndex
CREATE INDEX "stock_items_tenantId_depositoId_idx" ON "stock_items"("tenantId", "depositoId");
