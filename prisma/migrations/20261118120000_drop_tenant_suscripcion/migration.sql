-- La suscripción de cada empresa (estado, renovación y máximo de usuarios) se maneja en
-- otro sistema. Ninguna regla de Vialto la leía (no bloqueaba accesos ni usuarios).
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "billingStatus";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "billingRenewsAt";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "maxUsers";
