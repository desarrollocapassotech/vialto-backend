-- AlterTable
ALTER TABLE "choferes" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "vehiculos" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "choferes_tenantId_activo_idx" ON "choferes"("tenantId", "activo");

-- CreateIndex
CREATE INDEX "vehiculos_tenantId_activo_idx" ON "vehiculos"("tenantId", "activo");
