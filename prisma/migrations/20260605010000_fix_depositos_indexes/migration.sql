-- DropIndex simple (reemplazado por índice compuesto con tenantId)
DROP INDEX "movimientos_stock_depositoId_idx";

-- DropIndex simple (reemplazado por índice compuesto con tenantId)
DROP INDEX "stock_items_depositoId_idx";

-- AlterTable: quitar DEFAULT de updatedAt (Prisma lo maneja a nivel de aplicación)
ALTER TABLE "depositos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex compuesto para queries eficientes por tenant + depósito
CREATE INDEX "movimientos_stock_tenantId_depositoId_idx" ON "movimientos_stock"("tenantId", "depositoId");

-- CreateIndex compuesto para queries eficientes por tenant + depósito
CREATE INDEX "stock_items_tenantId_depositoId_idx" ON "stock_items"("tenantId", "depositoId");
