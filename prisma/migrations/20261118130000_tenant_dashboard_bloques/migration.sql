-- Bloques configurables del dashboard de inicio ([] = set recomendado por módulos).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "dashboardBloques" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
