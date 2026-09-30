-- Validación de CUIT contra el padrón de ARCA, opt-in por empresa (deshabilitada por defecto).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "validacionCuitArcaHabilitada" BOOLEAN NOT NULL DEFAULT false;
