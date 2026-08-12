-- Facturar por tramo: flag en factura + líneas de tramo por viaje
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / FK con duplicate_object

ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "facturarPorTramo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "factura_tramos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facturaId" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "ivaPct" DOUBLE PRECISION NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factura_tramos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "factura_tramos_facturaId_idx" ON "factura_tramos"("facturaId");
CREATE INDEX IF NOT EXISTS "factura_tramos_tenantId_idx" ON "factura_tramos"("tenantId");
CREATE INDEX IF NOT EXISTS "factura_tramos_viajeId_idx" ON "factura_tramos"("viajeId");

DO $$ BEGIN
  ALTER TABLE "factura_tramos" ADD CONSTRAINT "factura_tramos_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "factura_tramos" ADD CONSTRAINT "factura_tramos_facturaId_fkey"
    FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "factura_tramos" ADD CONSTRAINT "factura_tramos_viajeId_fkey"
    FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
