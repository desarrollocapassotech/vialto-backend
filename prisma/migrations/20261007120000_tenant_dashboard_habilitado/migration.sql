-- Dashboard de inicio configurable por empresa (habilitado por defecto).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "dashboardHabilitado" BOOLEAN NOT NULL DEFAULT true;
