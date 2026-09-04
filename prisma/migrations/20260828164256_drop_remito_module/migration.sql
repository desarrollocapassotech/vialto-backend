/*
  Warnings:

  - You are about to drop the column `remitoId` on the `movimientos_stock` table. All the data in the column will be lost.
  - You are about to drop the column `remitoId` on the `stock_operaciones` table. All the data in the column will be lost.
  - You are about to drop the `remitos` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "movimientos_stock" DROP CONSTRAINT "movimientos_stock_remitoId_fkey";

-- DropForeignKey
ALTER TABLE "remitos" DROP CONSTRAINT "remitos_choferId_fkey";

-- DropForeignKey
ALTER TABLE "remitos" DROP CONSTRAINT "remitos_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "remitos" DROP CONSTRAINT "remitos_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "remitos" DROP CONSTRAINT "remitos_vehiculoId_fkey";

-- DropForeignKey
ALTER TABLE "stock_operaciones" DROP CONSTRAINT "stock_operaciones_remitoId_fkey";

-- DropIndex
DROP INDEX "movimientos_stock_tenantId_remitoId_idx";

-- AlterTable
ALTER TABLE "movimientos_stock" DROP COLUMN "remitoId";

-- AlterTable
ALTER TABLE "stock_operaciones" DROP COLUMN "remitoId";

-- DropTable
DROP TABLE "remitos";
