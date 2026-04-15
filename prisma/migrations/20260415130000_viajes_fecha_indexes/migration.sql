-- Índices compuestos para filtros de fecha en findAllPaginated
CREATE INDEX IF NOT EXISTS "viajes_tenantId_fechaCarga_idx"   ON viajes ("tenantId", "fechaCarga");
CREATE INDEX IF NOT EXISTS "viajes_tenantId_fechaDescarga_idx" ON viajes ("tenantId", "fechaDescarga");
