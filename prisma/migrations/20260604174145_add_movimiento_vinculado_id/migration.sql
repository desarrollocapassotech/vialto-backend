-- AlterTable
ALTER TABLE "movimientos_stock" ADD COLUMN     "movimientoVinculadoId" TEXT;

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

-- CreateIndex
CREATE INDEX "presentaciones_tenantId_idx" ON "presentaciones"("tenantId");

-- CreateIndex
CREATE INDEX "presentaciones_productoId_idx" ON "presentaciones"("productoId");

-- AddForeignKey
ALTER TABLE "presentaciones" ADD CONSTRAINT "presentaciones_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
