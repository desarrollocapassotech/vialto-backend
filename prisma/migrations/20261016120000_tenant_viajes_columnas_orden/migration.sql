-- Orden configurable de las columnas de la grilla de Viajes por tenant ([] = orden estándar).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "viajesColumnasOrden" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
