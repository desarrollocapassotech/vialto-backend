-- Performance indexes: campos de alta frecuencia de consulta sin cobertura previa
-- Referencia de análisis: CLAUDE.md + servicios de módulos

-- ─────────────────────────────────────────────────────────────────────────────
-- viajes
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden default (createdAt DESC) en findAll y findAllPaginated
CREATE INDEX IF NOT EXISTS "viajes_tenantId_createdAt_idx" ON "viajes"("tenantId", "createdAt" DESC);

-- Filtro por transportista en findAllPaginated
CREATE INDEX IF NOT EXISTS "viajes_tenantId_transportistaId_idx" ON "viajes"("tenantId", "transportistaId");

-- Agregados mensuales en tableroGeneral (reportes): fechaFinalizado gte/lt
CREATE INDEX IF NOT EXISTS "viajes_tenantId_fechaFinalizado_idx" ON "viajes"("tenantId", "fechaFinalizado");

-- auto-estado (updateMany): estado IN (...) AND fechaDescarga <= hoy
-- Extiende el índice existente [tenantId, estado] con fechaDescarga para evitar sort+filter extra
CREATE INDEX IF NOT EXISTS "viajes_tenantId_estado_fechaDescarga_idx" ON "viajes"("tenantId", "estado", "fechaDescarga");

-- ─────────────────────────────────────────────────────────────────────────────
-- facturas
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden principal del listado: fechaEmision DESC
CREATE INDEX IF NOT EXISTS "facturas_tenantId_fechaEmision_idx" ON "facturas"("tenantId", "fechaEmision");

-- ─────────────────────────────────────────────────────────────────────────────
-- movimientos_cuenta_corriente
-- ─────────────────────────────────────────────────────────────────────────────

-- calcSaldoCliente: WHERE tenantId + clienteId + tipo (cargo/pago) — muy frecuente
-- El índice [tenantId, clienteId] existente sigue siendo útil; este lo extiende para agg de tipo
CREATE INDEX IF NOT EXISTS "movimientos_cuenta_corriente_tenantId_clienteId_tipo_idx"
  ON "movimientos_cuenta_corriente"("tenantId", "clienteId", "tipo");

-- ─────────────────────────────────────────────────────────────────────────────
-- cargas_combustible
-- ─────────────────────────────────────────────────────────────────────────────

-- Filtro por mes (patrón principal del módulo): fecha gte/lt
CREATE INDEX IF NOT EXISTS "cargas_combustible_tenantId_fecha_idx" ON "cargas_combustible"("tenantId", "fecha");

-- Filtro opcional por chofer en findAll
CREATE INDEX IF NOT EXISTS "cargas_combustible_tenantId_choferId_idx" ON "cargas_combustible"("tenantId", "choferId");

-- Filtro de operador: WHERE createdBy = userId (rol operador)
CREATE INDEX IF NOT EXISTS "cargas_combustible_tenantId_createdBy_idx" ON "cargas_combustible"("tenantId", "createdBy");

-- ─────────────────────────────────────────────────────────────────────────────
-- intervenciones
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden principal: fecha DESC
CREATE INDEX IF NOT EXISTS "intervenciones_tenantId_fecha_idx" ON "intervenciones"("tenantId", "fecha");

-- ─────────────────────────────────────────────────────────────────────────────
-- remitos
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden principal del listado: fecha DESC
CREATE INDEX IF NOT EXISTS "remitos_tenantId_fecha_idx" ON "remitos"("tenantId", "fecha");

-- ─────────────────────────────────────────────────────────────────────────────
-- movimientos_stock
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden principal del listado: fecha DESC
CREATE INDEX IF NOT EXISTS "movimientos_stock_tenantId_fecha_idx" ON "movimientos_stock"("tenantId", "fecha");
