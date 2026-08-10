-- CreateIndex
CREATE UNIQUE INDEX "viajes_tenantId_numeroIdentificacionPersonalizado_key" ON "viajes"("tenantId", "numeroIdentificacionPersonalizado");
