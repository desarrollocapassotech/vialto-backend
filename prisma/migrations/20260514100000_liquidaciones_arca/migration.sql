-- Módulo: liquidaciones-arca (NyM Logística)
-- Entidades: ArcaConfig, Liquidacion, LiquidacionViaje, ArcaLog
-- La Factura existente recibe campos CAE opcionales (addon, no rompe nada existente).
-- condicionIva en Cliente/Transportista, comisionPct en Transportista.

-- ── Factura: campos ARCA opcionales (null para tenants sin módulo) ─────────────
ALTER TABLE "facturas"
  ADD COLUMN IF NOT EXISTS "cbteTipo"    INTEGER,
  ADD COLUMN IF NOT EXISTS "cbteNro"     INTEGER,
  ADD COLUMN IF NOT EXISTS "ptoVenta"    INTEGER,
  ADD COLUMN IF NOT EXISTS "cae"         TEXT,
  ADD COLUMN IF NOT EXISTS "caeFechaVto" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "arcaEstado"  TEXT,
  ADD COLUMN IF NOT EXISTS "arcaError"   TEXT;

-- ── Cliente: condicionIva ─────────────────────────────────────────────────────
ALTER TABLE "clientes"
  ADD COLUMN IF NOT EXISTS "condicionIva" INTEGER;

-- ── Transportista: condicionIva + comisionPct ────────────────────────────────
ALTER TABLE "transportistas"
  ADD COLUMN IF NOT EXISTS "condicionIva" INTEGER,
  ADD COLUMN IF NOT EXISTS "comisionPct"  DOUBLE PRECISION;

-- ── ArcaConfig ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "arca_configs" (
  "tenantId"            TEXT NOT NULL,
  "cuitEmisor"          TEXT NOT NULL,
  "ptoVentaCvlp"        INTEGER NOT NULL,
  "ptoVentaFactura"     INTEGER NOT NULL,
  "ambiente"            TEXT NOT NULL DEFAULT 'homologacion',
  "comisionPctDefault"  DOUBLE PRECISION NOT NULL DEFAULT 8,
  "comisionPctAlt"      DOUBLE PRECISION NOT NULL DEFAULT 7,
  "gastosAdminPorViaje" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ivaGastosAdmin"      DOUBLE PRECISION NOT NULL DEFAULT 21,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "arca_configs_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "arca_configs"
  DROP CONSTRAINT IF EXISTS "arca_configs_tenantId_fkey";
ALTER TABLE "arca_configs"
  ADD CONSTRAINT "arca_configs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Liquidacion (CVLP Tipo 60) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "liquidaciones" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "transportistaId" TEXT NOT NULL,
  "periodoDesde"    TIMESTAMP(3) NOT NULL,
  "periodoHasta"    TIMESTAMP(3) NOT NULL,
  "cantViajes"      INTEGER NOT NULL,
  "bruto"           DOUBLE PRECISION NOT NULL,
  "comisionPct"     DOUBLE PRECISION NOT NULL,
  "comision"        DOUBLE PRECISION NOT NULL,
  "gastosAdmin"     DOUBLE PRECISION NOT NULL,
  "gastosAdminIva"  DOUBLE PRECISION NOT NULL,
  "liquido"         DOUBLE PRECISION NOT NULL,
  "cbteTipo"        INTEGER NOT NULL DEFAULT 60,
  "cbteNro"         INTEGER,
  "ptoVenta"        INTEGER,
  "cae"             TEXT,
  "caeFechaVto"     TIMESTAMP(3),
  "estado"          TEXT NOT NULL DEFAULT 'borrador',
  "arcaError"       TEXT,
  "reintentos"      INTEGER NOT NULL DEFAULT 0,
  "payloadHash"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"       TEXT NOT NULL,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "liquidaciones"
  DROP CONSTRAINT IF EXISTS "liquidaciones_tenantId_fkey",
  DROP CONSTRAINT IF EXISTS "liquidaciones_transportistaId_fkey";
ALTER TABLE "liquidaciones"
  ADD CONSTRAINT "liquidaciones_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "liquidaciones_transportistaId_fkey"
  FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "liquidaciones_tenantId_idx"
  ON "liquidaciones"("tenantId");
CREATE INDEX IF NOT EXISTS "liquidaciones_tenantId_transportistaId_idx"
  ON "liquidaciones"("tenantId", "transportistaId");
CREATE INDEX IF NOT EXISTS "liquidaciones_tenantId_estado_idx"
  ON "liquidaciones"("tenantId", "estado");
CREATE INDEX IF NOT EXISTS "liquidaciones_tenantId_periodoDesde_periodoHasta_idx"
  ON "liquidaciones"("tenantId", "periodoDesde", "periodoHasta");

-- ── LiquidacionViaje ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "liquidacion_viajes" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "liquidacionId"       TEXT NOT NULL,
  "viajeId"             TEXT NOT NULL,
  "tnOrigen"            DOUBLE PRECISION,
  "tnDestino"           DOUBLE PRECISION,
  "tarifaTransportista" DOUBLE PRECISION,
  "subtotal"            DOUBLE PRECISION,
  CONSTRAINT "liquidacion_viajes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "liquidacion_viajes_liquidacionId_viajeId_key" UNIQUE ("liquidacionId", "viajeId")
);

ALTER TABLE "liquidacion_viajes"
  DROP CONSTRAINT IF EXISTS "liquidacion_viajes_liquidacionId_fkey",
  DROP CONSTRAINT IF EXISTS "liquidacion_viajes_viajeId_fkey";
ALTER TABLE "liquidacion_viajes"
  ADD CONSTRAINT "liquidacion_viajes_liquidacionId_fkey"
  FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "liquidacion_viajes_viajeId_fkey"
  FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "liquidacion_viajes_tenantId_idx"
  ON "liquidacion_viajes"("tenantId");
CREATE INDEX IF NOT EXISTS "liquidacion_viajes_liquidacionId_idx"
  ON "liquidacion_viajes"("liquidacionId");
CREATE INDEX IF NOT EXISTS "liquidacion_viajes_viajeId_idx"
  ON "liquidacion_viajes"("viajeId");

-- ── ArcaLog ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "arca_logs" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "liquidacionId" TEXT,
  "facturaId"     TEXT,
  "method"        TEXT NOT NULL,
  "ambiente"      TEXT NOT NULL,
  "cuit"          TEXT NOT NULL,
  "requestBody"   JSONB NOT NULL,
  "responseBody"  JSONB,
  "httpStatus"    INTEGER,
  "durationMs"    INTEGER,
  "exitoso"       BOOLEAN NOT NULL DEFAULT FALSE,
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "arca_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "arca_logs"
  DROP CONSTRAINT IF EXISTS "arca_logs_tenantId_fkey",
  DROP CONSTRAINT IF EXISTS "arca_logs_liquidacionId_fkey";
ALTER TABLE "arca_logs"
  ADD CONSTRAINT "arca_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "arca_logs_liquidacionId_fkey"
  FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "arca_logs_tenantId_idx"
  ON "arca_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "arca_logs_tenantId_liquidacionId_idx"
  ON "arca_logs"("tenantId", "liquidacionId");
CREATE INDEX IF NOT EXISTS "arca_logs_tenantId_facturaId_idx"
  ON "arca_logs"("tenantId", "facturaId");
CREATE INDEX IF NOT EXISTS "arca_logs_tenantId_createdAt_idx"
  ON "arca_logs"("tenantId", "createdAt" DESC);
