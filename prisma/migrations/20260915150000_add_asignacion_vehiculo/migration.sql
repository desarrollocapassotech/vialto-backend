-- CreateTable
CREATE TABLE "asignaciones_vehiculo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "choferId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "fechaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "asignaciones_vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asignaciones_vehiculo_tenantId_idx" ON "asignaciones_vehiculo"("tenantId");

-- CreateIndex
CREATE INDEX "asignaciones_vehiculo_tenantId_choferId_fechaHasta_idx" ON "asignaciones_vehiculo"("tenantId", "choferId", "fechaHasta");

-- CreateIndex
CREATE INDEX "asignaciones_vehiculo_tenantId_vehiculoId_idx" ON "asignaciones_vehiculo"("tenantId", "vehiculoId");

-- AddForeignKey
ALTER TABLE "asignaciones_vehiculo" ADD CONSTRAINT "asignaciones_vehiculo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_vehiculo" ADD CONSTRAINT "asignaciones_vehiculo_choferId_fkey" FOREIGN KEY ("choferId") REFERENCES "choferes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_vehiculo" ADD CONSTRAINT "asignaciones_vehiculo_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
