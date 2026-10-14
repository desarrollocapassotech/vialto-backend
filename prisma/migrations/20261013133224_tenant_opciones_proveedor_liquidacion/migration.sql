-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "proveedorContrato" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "opcionesProveedorLiquidacion" TEXT[] DEFAULT ARRAY[]::TEXT[];
