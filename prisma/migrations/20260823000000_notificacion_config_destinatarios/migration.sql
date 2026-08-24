-- ═══════════════════════════════════════════════════════════════════════════
-- Destinatarios configurables por tipo de notificación: además de activo/inactivo,
-- el tenant puede elegir a mano qué usuarios (sin importar rol) reciben cada aviso.
-- Vacío (default) = todos los org:admin, comportamiento actual sin cambios.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "notificacion_configs"
  ADD COLUMN "destinatarios" TEXT[] NOT NULL DEFAULT '{}';
