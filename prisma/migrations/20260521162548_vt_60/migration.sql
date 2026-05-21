/*
  Warnings:

  - You are about to drop the column `pesoKg` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `remito` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `unidad` on the `productos` table. All the data in the column will be lost.
  - You are about to drop the `cargas` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `viajes_cargas` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tenantId,numero]` on the table `facturas` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,nombreNormalizado]` on the table `productos` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `createdBy` to the `intervenciones` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nombreNormalizado` to the `productos` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unidadMedida` to the `productos` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `productos` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "cargas" DROP CONSTRAINT "cargas_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "viajes_cargas" DROP CONSTRAINT "viajes_cargas_cargaId_fkey";

-- DropForeignKey
ALTER TABLE "viajes_cargas" DROP CONSTRAINT "viajes_cargas_viajeId_fkey";

-- DropIndex
DROP INDEX "idx_viajes_destino_trgm";

-- DropIndex
DROP INDEX "idx_viajes_origen_trgm";

-- AlterTable
ALTER TABLE "choferes" ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "facturas" ADD COLUMN     "transportistaId" TEXT;

-- AlterTable
ALTER TABLE "import_logs" ALTER COLUMN "detalles" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_sessions" ALTER COLUMN "filasValidas" DROP DEFAULT,
ALTER COLUMN "errores" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_templates" ALTER COLUMN "config" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "intervenciones" ADD COLUMN     "createdBy" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "movimientos_stock" DROP COLUMN "pesoKg",
DROP COLUMN "remito",
ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "observaciones" TEXT,
ADD COLUMN     "presentacionId" TEXT,
ADD COLUMN     "remitoId" TEXT,
ADD COLUMN     "remitoUrl" TEXT;

-- AlterTable
ALTER TABLE "productos" DROP COLUMN "unidad",
ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "nombreNormalizado" TEXT NOT NULL,
ADD COLUMN     "unidadMedida" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "stock_egreso_remito_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transportistas" ADD COLUMN     "domicilio" TEXT,
ADD COLUMN     "fechaVencimientoPermiso" TIMESTAMP(3),
ADD COLUMN     "paut" TEXT,
ADD COLUMN     "permisoInternacional" TEXT;

-- AlterTable
ALTER TABLE "viajes" ADD COLUMN     "pagosTransportista" JSONB NOT NULL DEFAULT '[]';

-- DropTable
DROP TABLE "cargas";

-- DropTable
DROP TABLE "viajes_cargas";

-- CreateTable
CREATE TABLE "viajes_productos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cantidad" DOUBLE PRECISION,
    "pesoKg" DOUBLE PRECISION,

    CONSTRAINT "viajes_productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presentaciones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidadEquivalente" DOUBLE PRECISION NOT NULL,
    "unidadEquivalente" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presentaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "presentacionId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viajes_productos_tenantId_idx" ON "viajes_productos"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_productos_viajeId_idx" ON "viajes_productos"("viajeId");

-- CreateIndex
CREATE INDEX "viajes_productos_productoId_idx" ON "viajes_productos"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "viajes_productos_viajeId_productoId_key" ON "viajes_productos"("viajeId", "productoId");

-- CreateIndex
CREATE INDEX "presentaciones_tenantId_idx" ON "presentaciones"("tenantId");

-- CreateIndex
CREATE INDEX "presentaciones_productoId_idx" ON "presentaciones"("productoId");

-- CreateIndex
CREATE INDEX "stock_items_tenantId_idx" ON "stock_items"("tenantId");

-- CreateIndex
CREATE INDEX "stock_items_tenantId_clienteId_idx" ON "stock_items"("tenantId", "clienteId");

-- CreateIndex
CREATE INDEX "stock_items_tenantId_productoId_idx" ON "stock_items"("tenantId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_productoId_presentacionId_clienteId_key" ON "stock_items"("productoId", "presentacionId", "clienteId");

-- CreateIndex
CREATE INDEX "facturas_tenantId_transportistaId_idx" ON "facturas"("tenantId", "transportistaId");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_tenantId_numero_key" ON "facturas"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_presentacionId_idx" ON "movimientos_stock"("tenantId", "presentacionId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_remitoId_idx" ON "movimientos_stock"("tenantId", "remitoId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_createdAt_idx" ON "movimientos_stock"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pagos_tenantId_facturaId_idx" ON "pagos"("tenantId", "facturaId");

-- CreateIndex
CREATE INDEX "productos_tenantId_activo_idx" ON "productos"("tenantId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "productos_tenantId_nombreNormalizado_key" ON "productos"("tenantId", "nombreNormalizado");

-- CreateIndex
CREATE INDEX "remitos_tenantId_estado_idx" ON "remitos"("tenantId", "estado");

-- AddForeignKey
ALTER TABLE "viajes_productos" ADD CONSTRAINT "viajes_productos_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes_productos" ADD CONSTRAINT "viajes_productos_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_transportistaId_fkey" FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presentaciones" ADD CONSTRAINT "presentaciones_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_remitoId_fkey" FOREIGN KEY ("remitoId") REFERENCES "remitos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "tenants_cuit_key" RENAME TO "tenants_idFiscal_key";
