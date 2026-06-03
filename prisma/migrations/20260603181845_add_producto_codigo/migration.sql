/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,codigo]` on the table `productos` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "productos" ADD COLUMN     "codigo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "productos_tenantId_codigo_key" ON "productos"("tenantId", "codigo");
