-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo notificaciones: alertas por email (Resend), configurables por tenant.
--
--   • notificacion_configs — override por tenant de si un tipo de notificación
--     (catálogo en código, `notificaciones-catalog.ts`) está activo o no. Sin
--     fila = se usa el default del catálogo.
--   • notificacion_envios  — dedup: qué entidad ya generó un email para un tipo
--     de notificación, para no reenviar el mismo aviso en cada corrida del cron.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "notificacion_configs" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "tipo"      TEXT         NOT NULL,
  "activo"    BOOLEAN      NOT NULL,
  "updatedBy" TEXT         NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notificacion_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notificacion_configs_tenantId_tipo_key"
  ON "notificacion_configs"("tenantId", "tipo");
CREATE INDEX "notificacion_configs_tenantId_idx"
  ON "notificacion_configs"("tenantId");

ALTER TABLE "notificacion_configs"
  ADD CONSTRAINT "notificacion_configs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notificacion_envios" (
  "id"            TEXT         NOT NULL,
  "tenantId"      TEXT         NOT NULL,
  "tipo"          TEXT         NOT NULL,
  "entidadId"     TEXT         NOT NULL,
  "destinatarios" TEXT[],
  "enviadoAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_envios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notificacion_envios_tenantId_tipo_entidadId_key"
  ON "notificacion_envios"("tenantId", "tipo", "entidadId");
CREATE INDEX "notificacion_envios_tenantId_tipo_idx"
  ON "notificacion_envios"("tenantId", "tipo");

ALTER TABLE "notificacion_envios"
  ADD CONSTRAINT "notificacion_envios_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId")
    ON DELETE CASCADE ON UPDATE CASCADE;
