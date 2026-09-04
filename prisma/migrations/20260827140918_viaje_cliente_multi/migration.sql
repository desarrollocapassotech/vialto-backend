-- AlterTable
ALTER TABLE "factura_tramos" ADD COLUMN     "viajeClienteId" TEXT;

-- CreateTable
CREATE TABLE "viajes_clientes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "origen" TEXT,
    "destino" TEXT,
    "detalleCarga" TEXT,
    "formaCobro" TEXT NOT NULL DEFAULT 'monto_fijo',
    "monto" DOUBLE PRECISION,
    "monedaMonto" TEXT NOT NULL DEFAULT 'ARS',
    "cantidad" DOUBLE PRECISION,
    "precioUnitario" DOUBLE PRECISION,
    "facturaId" TEXT,
    "facturacionEstado" TEXT NOT NULL DEFAULT 'sin_facturar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viajes_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viajes_clientes_tenantId_idx" ON "viajes_clientes"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_clientes_tenantId_viajeId_idx" ON "viajes_clientes"("tenantId", "viajeId");

-- CreateIndex
CREATE INDEX "viajes_clientes_tenantId_clienteId_idx" ON "viajes_clientes"("tenantId", "clienteId");

-- CreateIndex
CREATE INDEX "viajes_clientes_tenantId_facturaId_idx" ON "viajes_clientes"("tenantId", "facturaId");

-- CreateIndex
CREATE UNIQUE INDEX "viajes_clientes_viajeId_clienteId_key" ON "viajes_clientes"("viajeId", "clienteId");

-- CreateIndex
CREATE INDEX "factura_tramos_viajeClienteId_idx" ON "factura_tramos"("viajeClienteId");

-- AddForeignKey
ALTER TABLE "viajes_clientes" ADD CONSTRAINT "viajes_clientes_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes_clientes" ADD CONSTRAINT "viajes_clientes_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes_clientes" ADD CONSTRAINT "viajes_clientes_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_tramos" ADD CONSTRAINT "factura_tramos_viajeClienteId_fkey" FOREIGN KEY ("viajeClienteId") REFERENCES "viajes_clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "producto_presentaciones_productoId_presentacionId_unidade_key" RENAME TO "producto_presentaciones_productoId_presentacionId_unidadesP_key";
