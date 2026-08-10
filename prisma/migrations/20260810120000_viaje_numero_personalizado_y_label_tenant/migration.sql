-- AlterTable
ALTER TABLE "viajes" ADD COLUMN "numeroIdentificacionPersonalizado" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "labelIdentificacionPersonalizadaViajes" TEXT DEFAULT 'ID propio';
