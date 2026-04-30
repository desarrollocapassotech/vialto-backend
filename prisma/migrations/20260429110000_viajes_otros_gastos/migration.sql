-- AlterTable: add otrosGastos JSON column to viajes
ALTER TABLE "viajes" ADD COLUMN "otrosGastos" JSONB NOT NULL DEFAULT '[]';
