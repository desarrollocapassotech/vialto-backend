-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "paisOrigenDestinoOculto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paisOrigenDestinoFijoId" TEXT;
