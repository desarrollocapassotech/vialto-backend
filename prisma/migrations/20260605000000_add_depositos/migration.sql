-- CreateTable
CREATE TABLE "depositos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depositos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depositos_tenantId_idx" ON "depositos"("tenantId");

-- CreateIndex
CREATE INDEX "depositos_tenantId_activo_idx" ON "depositos"("tenantId", "activo");

-- AddForeignKey
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "movimientos_stock" ADD COLUMN "depositoId" TEXT;

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN "depositoId" TEXT;

-- Backfill depositos for existing tenants
INSERT INTO "depositos" ("id", "tenantId", "nombre", "descripcion", "activo")
SELECT md5(random()::text || clock_timestamp()::text), "clerkOrgId", 'Depósito principal', 'Depósito principal migrado', TRUE
FROM "tenants";

-- Backfill existing stock and movement rows to the tenant default deposito
UPDATE "movimientos_stock" m
SET "depositoId" = d."id"
FROM "depositos" d
WHERE m."tenantId" = d."tenantId";

UPDATE "stock_items" s
SET "depositoId" = d."id"
FROM "depositos" d
WHERE s."tenantId" = d."tenantId";

-- Enforce not-null now that all rows have a value
ALTER TABLE "movimientos_stock" ALTER COLUMN "depositoId" SET NOT NULL;
ALTER TABLE "stock_items" ALTER COLUMN "depositoId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "movimientos_stock_depositoId_idx" ON "movimientos_stock"("depositoId");

-- CreateIndex
CREATE INDEX "stock_items_depositoId_idx" ON "stock_items"("depositoId");

-- Update unique index for stock item per deposit
ALTER TABLE "stock_items" DROP CONSTRAINT IF EXISTS "stock_items_productoId_clienteId_key";
CREATE UNIQUE INDEX "stock_items_productoId_clienteId_depositoId_key" ON "stock_items"("productoId", "clienteId", "depositoId");
