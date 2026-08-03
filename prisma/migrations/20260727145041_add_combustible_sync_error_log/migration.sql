-- CreateTable
CREATE TABLE "combustible_sync_error_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "choferId" TEXT,
    "vehiculoId" TEXT,
    "mensaje" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combustible_sync_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combustible_sync_error_logs_tenantId_idx" ON "combustible_sync_error_logs"("tenantId");

-- CreateIndex
CREATE INDEX "combustible_sync_error_logs_tenantId_choferId_idx" ON "combustible_sync_error_logs"("tenantId", "choferId");

-- CreateIndex
CREATE INDEX "combustible_sync_error_logs_tenantId_createdAt_idx" ON "combustible_sync_error_logs"("tenantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "combustible_sync_error_logs" ADD CONSTRAINT "combustible_sync_error_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combustible_sync_error_logs" ADD CONSTRAINT "combustible_sync_error_logs_choferId_fkey" FOREIGN KEY ("choferId") REFERENCES "choferes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combustible_sync_error_logs" ADD CONSTRAINT "combustible_sync_error_logs_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
