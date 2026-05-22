/*
  Migración VT-60 — reescrita para ser completamente idempotente.
  Toda la estructura fue aplicada manualmente en producción antes de que
  esta migración existiera, por lo que todos los comandos usan IF EXISTS /
  IF NOT EXISTS para ser seguros tanto en DBs vírgenes como ya migradas.
*/

-- DropForeignKey (IF EXISTS)
ALTER TABLE IF EXISTS "cargas" DROP CONSTRAINT IF EXISTS "cargas_tenantId_fkey";
ALTER TABLE IF EXISTS "viajes_cargas" DROP CONSTRAINT IF EXISTS "viajes_cargas_cargaId_fkey";
ALTER TABLE IF EXISTS "viajes_cargas" DROP CONSTRAINT IF EXISTS "viajes_cargas_viajeId_fkey";

-- DropIndex (IF EXISTS)
DROP INDEX IF EXISTS "idx_viajes_destino_trgm";
DROP INDEX IF EXISTS "idx_viajes_origen_trgm";

-- DropTable (IF EXISTS)
DROP TABLE IF EXISTS "cargas";
DROP TABLE IF EXISTS "viajes_cargas";

-- AlterTable choferes
ALTER TABLE "choferes" ADD COLUMN IF NOT EXISTS "cuit" TEXT;

-- AlterTable facturas
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "transportistaId" TEXT;

-- AlterTable import_logs
ALTER TABLE "import_logs" ALTER COLUMN "detalles" DROP DEFAULT;

-- AlterTable import_sessions
ALTER TABLE "import_sessions" ALTER COLUMN "filasValidas" DROP DEFAULT,
ALTER COLUMN "errores" DROP DEFAULT;

-- AlterTable import_templates
ALTER TABLE "import_templates" ALTER COLUMN "config" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable intervenciones
ALTER TABLE "intervenciones" ADD COLUMN IF NOT EXISTS "createdBy" TEXT NOT NULL DEFAULT '';

-- AlterTable movimientos_stock
ALTER TABLE "movimientos_stock"
  DROP COLUMN IF EXISTS "pesoKg",
  DROP COLUMN IF EXISTS "remito",
  ADD COLUMN IF NOT EXISTS "createdBy"      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "observaciones"  TEXT,
  ADD COLUMN IF NOT EXISTS "presentacionId" TEXT,
  ADD COLUMN IF NOT EXISTS "remitoId"       TEXT,
  ADD COLUMN IF NOT EXISTS "remitoUrl"      TEXT;

-- AlterTable productos
ALTER TABLE "productos"
  DROP COLUMN IF EXISTS "unidad",
  ADD COLUMN IF NOT EXISTS "activo"            BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "descripcion"       TEXT,
  ADD COLUMN IF NOT EXISTS "nombreNormalizado" TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "unidadMedida"      TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable stock_egreso_remito_configs
ALTER TABLE "stock_egreso_remito_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable transportistas
ALTER TABLE "transportistas"
  ADD COLUMN IF NOT EXISTS "domicilio"               TEXT,
  ADD COLUMN IF NOT EXISTS "fechaVencimientoPermiso" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paut"                    TEXT,
  ADD COLUMN IF NOT EXISTS "permisoInternacional"    TEXT;

-- AlterTable viajes
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "pagosTransportista" JSONB NOT NULL DEFAULT '[]';

-- CreateTable viajes_productos
CREATE TABLE IF NOT EXISTS "viajes_productos" (
    "id"         TEXT             NOT NULL,
    "tenantId"   TEXT             NOT NULL,
    "viajeId"    TEXT             NOT NULL,
    "productoId" TEXT             NOT NULL,
    "orden"      INTEGER          NOT NULL DEFAULT 0,
    "cantidad"   DOUBLE PRECISION,
    "pesoKg"     DOUBLE PRECISION,
    CONSTRAINT "viajes_productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable presentaciones
CREATE TABLE IF NOT EXISTS "presentaciones" (
    "id"                  TEXT             NOT NULL,
    "tenantId"            TEXT             NOT NULL,
    "productoId"          TEXT             NOT NULL,
    "nombre"              TEXT             NOT NULL,
    "cantidadEquivalente" DOUBLE PRECISION NOT NULL,
    "unidadEquivalente"   TEXT             NOT NULL,
    "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "presentaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable stock_items
CREATE TABLE IF NOT EXISTS "stock_items" (
    "id"            TEXT             NOT NULL,
    "tenantId"      TEXT             NOT NULL,
    "productoId"    TEXT             NOT NULL,
    "presentacionId" TEXT            NOT NULL,
    "clienteId"     TEXT             NOT NULL,
    "cantidad"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt"     TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "viajes_productos_tenantId_idx"           ON "viajes_productos"("tenantId");
CREATE INDEX IF NOT EXISTS "viajes_productos_viajeId_idx"            ON "viajes_productos"("viajeId");
CREATE INDEX IF NOT EXISTS "viajes_productos_productoId_idx"         ON "viajes_productos"("productoId");
CREATE UNIQUE INDEX IF NOT EXISTS "viajes_productos_viajeId_productoId_key" ON "viajes_productos"("viajeId", "productoId");
CREATE INDEX IF NOT EXISTS "presentaciones_tenantId_idx"             ON "presentaciones"("tenantId");
CREATE INDEX IF NOT EXISTS "presentaciones_productoId_idx"           ON "presentaciones"("productoId");
CREATE INDEX IF NOT EXISTS "stock_items_tenantId_idx"                ON "stock_items"("tenantId");
CREATE INDEX IF NOT EXISTS "stock_items_tenantId_clienteId_idx"      ON "stock_items"("tenantId", "clienteId");
CREATE INDEX IF NOT EXISTS "stock_items_tenantId_productoId_idx"     ON "stock_items"("tenantId", "productoId");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_items_productoId_presentacionId_clienteId_key" ON "stock_items"("productoId", "presentacionId", "clienteId");
CREATE INDEX IF NOT EXISTS "facturas_tenantId_transportistaId_idx"   ON "facturas"("tenantId", "transportistaId");
CREATE UNIQUE INDEX IF NOT EXISTS "facturas_tenantId_numero_key"      ON "facturas"("tenantId", "numero");
CREATE INDEX IF NOT EXISTS "movimientos_stock_tenantId_presentacionId_idx" ON "movimientos_stock"("tenantId", "presentacionId");
CREATE INDEX IF NOT EXISTS "movimientos_stock_tenantId_remitoId_idx" ON "movimientos_stock"("tenantId", "remitoId");
CREATE INDEX IF NOT EXISTS "movimientos_stock_tenantId_createdAt_idx" ON "movimientos_stock"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "pagos_tenantId_facturaId_idx"            ON "pagos"("tenantId", "facturaId");
CREATE INDEX IF NOT EXISTS "productos_tenantId_activo_idx"           ON "productos"("tenantId", "activo");
CREATE UNIQUE INDEX IF NOT EXISTS "productos_tenantId_nombreNormalizado_key" ON "productos"("tenantId", "nombreNormalizado");
CREATE INDEX IF NOT EXISTS "remitos_tenantId_estado_idx"             ON "remitos"("tenantId", "estado");

-- AddForeignKey (condicional — IF NOT EXISTS via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viajes_productos_viajeId_fkey') THEN
    ALTER TABLE "viajes_productos" ADD CONSTRAINT "viajes_productos_viajeId_fkey"
      FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viajes_productos_productoId_fkey') THEN
    ALTER TABLE "viajes_productos" ADD CONSTRAINT "viajes_productos_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facturas_transportistaId_fkey') THEN
    ALTER TABLE "facturas" ADD CONSTRAINT "facturas_transportistaId_fkey"
      FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presentaciones_productoId_fkey') THEN
    ALTER TABLE "presentaciones" ADD CONSTRAINT "presentaciones_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_stock_presentacionId_fkey') THEN
    ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_presentacionId_fkey"
      FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_stock_remitoId_fkey') THEN
    ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_remitoId_fkey"
      FOREIGN KEY ("remitoId") REFERENCES "remitos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_tenantId_fkey') THEN
    ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_productoId_fkey') THEN
    ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_presentacionId_fkey') THEN
    ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_presentacionId_fkey"
      FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_clienteId_fkey') THEN
    ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_clienteId_fkey"
      FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_templates_tenantId_fkey') THEN
    ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_sessions_tenantId_fkey') THEN
    ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_sessions_templateId_fkey') THEN
    ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_logs_tenantId_fkey') THEN
    ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_logs_templateId_fkey') THEN
    ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- RenameIndex (condicional — solo si el nombre viejo existe y el nuevo no)
DO $$ BEGIN
  IF EXISTS     (SELECT 1 FROM pg_indexes WHERE indexname = 'tenants_cuit_key')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tenants_idFiscal_key') THEN
    ALTER INDEX "tenants_cuit_key" RENAME TO "tenants_idFiscal_key";
  END IF;
END $$;

-- Drop temporary column defaults (solo necesarios para el ADD COLUMN IF NOT EXISTS inicial, no son parte del esquema)
ALTER TABLE "intervenciones" ALTER COLUMN "createdBy" DROP DEFAULT;
ALTER TABLE "productos" ALTER COLUMN "nombreNormalizado" DROP DEFAULT;
ALTER TABLE "productos" ALTER COLUMN "unidadMedida" DROP DEFAULT;
ALTER TABLE "productos" ALTER COLUMN "updatedAt" DROP DEFAULT;
