-- AlterTable
ALTER TABLE "liquidacion_concepto_lineas" ADD COLUMN     "modoAplicacion" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "viajeId" TEXT;
