-- AlterTable
ALTER TABLE "viajes_productos" ADD COLUMN IF NOT EXISTS "pesoTn" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "viajes_clientes_productos" ADD COLUMN IF NOT EXISTS "pesoTn" DOUBLE PRECISION;
