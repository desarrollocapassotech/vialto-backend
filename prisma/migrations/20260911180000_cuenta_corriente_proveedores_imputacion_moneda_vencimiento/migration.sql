-- DropIndex
DROP INDEX "movimientos_cuenta_corriente_tenantId_viajeId_key";

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "condicionPagoDias" INTEGER;

-- AlterTable
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN     "contraparteId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "estadoDisponibilidad" TEXT NOT NULL DEFAULT 'pendiente',
ADD COLUMN     "estadoImputacion" TEXT NOT NULL DEFAULT 'no_imputado',
ADD COLUMN     "facturaId" TEXT,
ADD COLUMN     "fechaVencimiento" TIMESTAMP(3),
ADD COLUMN     "moneda" TEXT NOT NULL DEFAULT 'ARS',
ADD COLUMN     "numeroComprobante" TEXT,
ADD COLUMN     "proveedorId" TEXT,
ALTER COLUMN "clienteId" DROP NOT NULL;

-- Backfill: todas las filas existentes son de cliente (proveedores recién se suman en esta migración)
UPDATE "movimientos_cuenta_corriente" SET "contraparteId" = "clienteId" WHERE "contraparteId" IS NULL;

ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "contraparteId" SET NOT NULL;

-- AlterTable
ALTER TABLE "transportistas" ADD COLUMN     "condicionPagoDias" INTEGER;

-- CreateTable
CREATE TABLE "imputaciones_cuenta_corriente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "cargoId" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "imputaciones_cuenta_corriente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imputaciones_cuenta_corriente_tenantId_idx" ON "imputaciones_cuenta_corriente"("tenantId");

-- CreateIndex
CREATE INDEX "imputaciones_cuenta_corriente_tenantId_pagoId_idx" ON "imputaciones_cuenta_corriente"("tenantId", "pagoId");

-- CreateIndex
CREATE INDEX "imputaciones_cuenta_corriente_tenantId_cargoId_idx" ON "imputaciones_cuenta_corriente"("tenantId", "cargoId");

-- CreateIndex
CREATE UNIQUE INDEX "imputaciones_cuenta_corriente_pagoId_cargoId_key" ON "imputaciones_cuenta_corriente"("pagoId", "cargoId");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_proveedorId_idx" ON "movimientos_cuenta_corriente"("tenantId", "proveedorId");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_proveedorId_tipo_idx" ON "movimientos_cuenta_corriente"("tenantId", "proveedorId", "tipo");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_facturaId_idx" ON "movimientos_cuenta_corriente"("tenantId", "facturaId");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_viajeId_contraparteId_key" ON "movimientos_cuenta_corriente"("tenantId", "viajeId", "contraparteId");

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "transportistas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "movimientos_cuenta_corriente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "movimientos_cuenta_corriente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
