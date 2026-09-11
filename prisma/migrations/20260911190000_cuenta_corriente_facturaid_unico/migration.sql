-- CreateIndex
CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_facturaId_key" ON "movimientos_cuenta_corriente"("tenantId", "facturaId");
