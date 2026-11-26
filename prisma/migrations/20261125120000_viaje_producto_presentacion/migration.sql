-- AlterTable
ALTER TABLE "viajes_productos" ADD COLUMN IF NOT EXISTS "presentacionId" TEXT;

-- AlterTable
ALTER TABLE "viajes_clientes_productos" ADD COLUMN IF NOT EXISTS "presentacionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viajes_productos_presentacionId_idx" ON "viajes_productos"("presentacionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viajes_clientes_productos_presentacionId_idx" ON "viajes_clientes_productos"("presentacionId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viajes_productos_presentacionId_fkey'
  ) THEN
    ALTER TABLE "viajes_productos" ADD CONSTRAINT "viajes_productos_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viajes_clientes_productos_presentacionId_fkey'
  ) THEN
    ALTER TABLE "viajes_clientes_productos" ADD CONSTRAINT "viajes_clientes_productos_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
