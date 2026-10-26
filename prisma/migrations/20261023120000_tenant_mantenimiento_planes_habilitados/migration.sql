-- Switch de superadmin: planes de Mantenimiento por empresa (default prendido).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "mantenimientoPlanesHabilitados" BOOLEAN NOT NULL DEFAULT true;
