-- AlterTable
ALTER TABLE "producto_presentaciones" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_operaciones" ADD COLUMN     "fotosUrls" TEXT[];
