-- Habilita la columna opcional "Observaciones" en la grilla de Viajes por empresa.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "viajesObservaciones" BOOLEAN NOT NULL DEFAULT false;
