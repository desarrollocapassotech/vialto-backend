-- Agrega datos del emisor a arca_configs para generar el PDF del comprobante.
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "razonSocial" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "domicilioEmisor" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "condicionIvaEmisor" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "ingBrutos" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN IF NOT EXISTS "inicActEmisor" TEXT;
