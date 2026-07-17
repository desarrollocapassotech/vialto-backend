-- AlterTable
ALTER TABLE "cargas_combustible" ADD COLUMN     "litrosOriginal" DOUBLE PRECISION,
ADD COLUMN     "motivoSospecha" TEXT,
ADD COLUMN     "sospechoso" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "cargas_combustible_tenantId_sospechoso_idx" ON "cargas_combustible"("tenantId", "sospechoso");
