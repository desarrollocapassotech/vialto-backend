-- Elimina la columna apiKeyEncrypted que ya no se usa.
-- La API key ahora viene de la variable de entorno AFIP_SDK_API_KEY.
ALTER TABLE "arca_configs" DROP COLUMN IF EXISTS "apiKeyEncrypted";
