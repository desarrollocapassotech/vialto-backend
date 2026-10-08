-- Registro server-side de errores de la app de choferes (login, cargas online, fotos, etc.).
-- Las filas existentes son todas reportes de la cola offline → toman el default.
ALTER TABLE "combustible_sync_error_logs" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'sincronizacion_offline';

CREATE INDEX "combustible_sync_error_logs_tenantId_origen_createdAt_idx" ON "combustible_sync_error_logs"("tenantId", "origen", "createdAt" DESC);
