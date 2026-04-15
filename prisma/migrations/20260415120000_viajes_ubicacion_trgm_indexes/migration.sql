-- Habilitar extensión de trigrams para soporte de ILIKE con índice
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices GIN en origen y destino para búsquedas ILIKE eficientes
CREATE INDEX IF NOT EXISTS idx_viajes_origen_trgm  ON viajes USING GIN (origen  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_viajes_destino_trgm ON viajes USING GIN (destino gin_trgm_ops);
