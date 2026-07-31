-- AlterTable
ALTER TABLE "combustible_sync_error_logs" ADD COLUMN     "resueltoEn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "combustible_sync_error_logs_tenantId_resueltoEn_idx" ON "combustible_sync_error_logs"("tenantId", "resueltoEn");
