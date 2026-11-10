-- Opción de flota marcada por defecto al crear Viaje/Chofer/Vehículo (propia | externa).
-- null = comportamiento previo (Viajes: externa; Choferes/Vehículos: propia).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tipoFlotaDefault" TEXT;
