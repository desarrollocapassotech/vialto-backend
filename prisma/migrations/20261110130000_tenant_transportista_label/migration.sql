-- Nombre propio del transportista externo por empresa (ej. "Fletero"). null = "Transportista".
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "transportistaLabel" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "transportistaLabelPlural" TEXT;
