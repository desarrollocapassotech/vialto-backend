-- CreateTable
CREATE TABLE "vehiculo_km_ediciones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "kmAnterior" INTEGER NOT NULL,
    "kmNuevo" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehiculo_km_ediciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehiculo_km_ediciones_tenantId_idx" ON "vehiculo_km_ediciones"("tenantId");

-- CreateIndex
CREATE INDEX "vehiculo_km_ediciones_tenantId_vehiculoId_fecha_idx" ON "vehiculo_km_ediciones"("tenantId", "vehiculoId", "fecha");

-- AddForeignKey
ALTER TABLE "vehiculo_km_ediciones" ADD CONSTRAINT "vehiculo_km_ediciones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculo_km_ediciones" ADD CONSTRAINT "vehiculo_km_ediciones_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
