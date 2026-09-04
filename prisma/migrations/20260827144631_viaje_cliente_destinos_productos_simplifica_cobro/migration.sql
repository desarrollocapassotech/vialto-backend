/*
  Warnings:

  - You are about to drop the column `detalleCarga` on the `viajes_clientes` table. All the data in the column will be lost.
  - You are about to drop the column `formaCobro` on the `viajes_clientes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "viajes_clientes" DROP COLUMN "detalleCarga",
DROP COLUMN "formaCobro";

-- CreateTable
CREATE TABLE "viajes_clientes_destinos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viajeClienteId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "etiqueta" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viajes_clientes_destinos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viajes_clientes_productos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viajeClienteId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cantidad" DOUBLE PRECISION,
    "pesoKg" DOUBLE PRECISION,

    CONSTRAINT "viajes_clientes_productos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viajes_clientes_destinos_tenantId_idx" ON "viajes_clientes_destinos"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_clientes_destinos_viajeClienteId_idx" ON "viajes_clientes_destinos"("viajeClienteId");

-- CreateIndex
CREATE UNIQUE INDEX "viajes_clientes_destinos_viajeClienteId_orden_key" ON "viajes_clientes_destinos"("viajeClienteId", "orden");

-- CreateIndex
CREATE INDEX "viajes_clientes_productos_tenantId_idx" ON "viajes_clientes_productos"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_clientes_productos_viajeClienteId_idx" ON "viajes_clientes_productos"("viajeClienteId");

-- CreateIndex
CREATE INDEX "viajes_clientes_productos_productoId_idx" ON "viajes_clientes_productos"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "viajes_clientes_productos_viajeClienteId_productoId_key" ON "viajes_clientes_productos"("viajeClienteId", "productoId");

-- AddForeignKey
ALTER TABLE "viajes_clientes_destinos" ADD CONSTRAINT "viajes_clientes_destinos_viajeClienteId_fkey" FOREIGN KEY ("viajeClienteId") REFERENCES "viajes_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes_clientes_productos" ADD CONSTRAINT "viajes_clientes_productos_viajeClienteId_fkey" FOREIGN KEY ("viajeClienteId") REFERENCES "viajes_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes_clientes_productos" ADD CONSTRAINT "viajes_clientes_productos_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
