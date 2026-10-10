-- Switch por empresa: acción "Marcar como cobrada" en Facturas (default apagado).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "marcarCobradaHabilitada" BOOLEAN NOT NULL DEFAULT false;
