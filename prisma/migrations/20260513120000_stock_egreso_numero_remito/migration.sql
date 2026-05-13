-- Secuencia y formato de número de remito para egresos de stock
CREATE TABLE "stock_remito_secuencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "stock_remito_secuencias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_remito_secuencias_tenantId_year_key" ON "stock_remito_secuencias"("tenantId", "year");

ALTER TABLE "stock_remito_secuencias" ADD CONSTRAINT "stock_remito_secuencias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stock_egreso_remito_configs" (
    "tenantId" TEXT NOT NULL,
    "remitoPrefix" TEXT NOT NULL DEFAULT 'R',
    "remitoDigitos" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_egreso_remito_configs_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "stock_egreso_remito_configs" ADD CONSTRAINT "stock_egreso_remito_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movimientos_stock" ADD COLUMN "numeroRemito" TEXT;

CREATE UNIQUE INDEX "movimientos_stock_tenantId_numeroRemito_key" ON "movimientos_stock"("tenantId", "numeroRemito");
