-- ═══════════════════════════════════════════════════════════════════════════
-- Feed de notificaciones (campana en la navbar): agrega a notificacion_envios
-- el snapshot de texto (titulo/detalle) que se mandó por email y el tracking
-- de lectura por usuario (leidoPor). Tabla sin filas todavía, por eso las
-- columnas nuevas van NOT NULL sin necesitar backfill.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "notificacion_envios"
  ADD COLUMN "titulo" TEXT NOT NULL,
  ADD COLUMN "detalle" TEXT NOT NULL,
  ADD COLUMN "leidoPor" TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX "notificacion_envios_tenantId_enviadoAt_idx"
  ON "notificacion_envios"("tenantId", "enviadoAt");
