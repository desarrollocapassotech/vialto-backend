-- ═══════════════════════════════════════════════════════════════════════════
-- Nuevo modelo de stock: StockOperacion + ProductoPresentacion
--
-- No hay datos reales en el módulo stock → las tablas afectadas se vacían
-- antes de alterar el schema. El resto de módulos no se toca.
--
-- Cambios de schema:
--   • CREATE  stock_operaciones, producto_presentaciones
--   • ALTER   movimientos_stock  — agrega operacionId, presentacionId,
--             fechaVencimiento, bultos, unidades; elimina clienteId,
--             depositoId, tipo, cantidad1, cantidad2, remitoUrl,
--             numeroRemito, entregadoPor, destinatario, destinoFinal
--   • ALTER   productos          — agrega pesoUnitarioKg; elimina
--             presentacion1Id, presentacion2Id, unidad1Nombre, unidad2Nombre
--   • ALTER   stock_items        — agrega presentacionId; cambia UNIQUE a
--             (productoId, presentacionId, clienteId, depositoId)
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- Vaciar tablas stock (sin datos reales → limpieza segura)
-- ────────────────────────────────────────────────────────────────────────────
TRUNCATE "movimientos_stock";
TRUNCATE "stock_items";

-- ────────────────────────────────────────────────────────────────────────────
-- Crear tabla stock_operaciones
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "stock_operaciones" (
  "id"            TEXT         NOT NULL,
  "tenantId"      TEXT         NOT NULL,
  "clienteId"     TEXT         NOT NULL,
  "depositoId"    TEXT         NOT NULL,
  "tipo"          TEXT         NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "observaciones" TEXT,
  "remitoUrl"     TEXT,
  "numeroRemito"  TEXT,
  "remitoId"      TEXT,
  "entregadoPor"  TEXT,
  "destinatario"  TEXT,
  "destinoFinal"  TEXT,
  "createdBy"     TEXT         NOT NULL DEFAULT '',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_operaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_operaciones_tenantId_numeroRemito_key"
  ON "stock_operaciones"("tenantId", "numeroRemito");
CREATE INDEX "stock_operaciones_tenantId_idx"
  ON "stock_operaciones"("tenantId");
CREATE INDEX "stock_operaciones_tenantId_clienteId_idx"
  ON "stock_operaciones"("tenantId", "clienteId");
CREATE INDEX "stock_operaciones_tenantId_depositoId_idx"
  ON "stock_operaciones"("tenantId", "depositoId");
CREATE INDEX "stock_operaciones_tenantId_tipo_idx"
  ON "stock_operaciones"("tenantId", "tipo");
CREATE INDEX "stock_operaciones_tenantId_fecha_idx"
  ON "stock_operaciones"("tenantId", "fecha");
CREATE INDEX "stock_operaciones_tenantId_createdAt_idx"
  ON "stock_operaciones"("tenantId", "createdAt" DESC);

ALTER TABLE "stock_operaciones"
  ADD CONSTRAINT "stock_operaciones_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_operaciones_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "clientes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_operaciones_depositoId_fkey"
    FOREIGN KEY ("depositoId") REFERENCES "depositos"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_operaciones_remitoId_fkey"
    FOREIGN KEY ("remitoId") REFERENCES "remitos"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- Crear tabla producto_presentaciones
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "producto_presentaciones" (
  "id"               TEXT             NOT NULL,
  "tenantId"         TEXT             NOT NULL,
  "productoId"       TEXT             NOT NULL,
  "presentacionId"   TEXT             NOT NULL,
  "unidadesPorBulto" DOUBLE PRECISION NOT NULL,
  "activo"           BOOLEAN          NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "producto_presentaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "producto_presentaciones_productoId_presentacionId_key"
  ON "producto_presentaciones"("productoId", "presentacionId");
CREATE INDEX "producto_presentaciones_tenantId_idx"
  ON "producto_presentaciones"("tenantId");
CREATE INDEX "producto_presentaciones_tenantId_productoId_idx"
  ON "producto_presentaciones"("tenantId", "productoId");

ALTER TABLE "producto_presentaciones"
  ADD CONSTRAINT "producto_presentaciones_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "producto_presentaciones_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "productos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "producto_presentaciones_presentacionId_fkey"
    FOREIGN KEY ("presentacionId") REFERENCES "presentaciones"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- Actualizar movimientos_stock
-- (la tabla ya está vacía → cambios directos sin backfill)
-- ────────────────────────────────────────────────────────────────────────────

-- Eliminar FKs de las columnas que se van
ALTER TABLE "movimientos_stock" DROP CONSTRAINT IF EXISTS "movimientos_stock_clienteId_fkey";
ALTER TABLE "movimientos_stock" DROP CONSTRAINT IF EXISTS "movimientos_stock_depositoId_fkey";

-- Eliminar índices afectados
DROP INDEX IF EXISTS "movimientos_stock_tenantId_clienteId_idx";
DROP INDEX IF EXISTS "movimientos_stock_clienteId_idx";
DROP INDEX IF EXISTS "movimientos_stock_tenantId_depositoId_idx";
DROP INDEX IF EXISTS "movimientos_stock_depositoId_idx";
DROP INDEX IF EXISTS "movimientos_stock_tenantId_numeroRemito_key";
ALTER TABLE "movimientos_stock" DROP CONSTRAINT IF EXISTS "movimientos_stock_tenantId_numeroRemito_key";

-- Eliminar columnas del viejo modelo
ALTER TABLE "movimientos_stock"
  DROP COLUMN "clienteId",
  DROP COLUMN "depositoId",
  DROP COLUMN "tipo",
  DROP COLUMN "cantidad1",
  DROP COLUMN "cantidad2",
  DROP COLUMN "remitoUrl",
  DROP COLUMN "numeroRemito",
  DROP COLUMN "entregadoPor",
  DROP COLUMN "destinatario",
  DROP COLUMN "destinoFinal";

-- Agregar columnas nuevas (NOT NULL directo porque la tabla está vacía)
ALTER TABLE "movimientos_stock"
  ADD COLUMN "operacionId"      TEXT             NOT NULL,
  ADD COLUMN "presentacionId"   TEXT,
  ADD COLUMN "fechaVencimiento" TIMESTAMP(3),
  ADD COLUMN "bultos"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "unidades"         DOUBLE PRECISION NOT NULL DEFAULT 0;

-- FKs nuevas
ALTER TABLE "movimientos_stock"
  ADD CONSTRAINT "movimientos_stock_operacionId_fkey"
    FOREIGN KEY ("operacionId") REFERENCES "stock_operaciones"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "movimientos_stock_presentacionId_fkey"
    FOREIGN KEY ("presentacionId") REFERENCES "producto_presentaciones"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices nuevos
CREATE INDEX "movimientos_stock_tenantId_operacionId_idx"
  ON "movimientos_stock"("tenantId", "operacionId");
CREATE INDEX "movimientos_stock_tenantId_presentacionId_idx"
  ON "movimientos_stock"("tenantId", "presentacionId");

-- ────────────────────────────────────────────────────────────────────────────
-- Actualizar stock_items
-- (la tabla ya está vacía → cambios directos)
-- ────────────────────────────────────────────────────────────────────────────

-- Eliminar unique antiguo (3 campos)
DROP INDEX IF EXISTS "stock_items_productoId_clienteId_depositoId_key";
ALTER TABLE "stock_items" DROP CONSTRAINT IF EXISTS "stock_items_productoId_clienteId_depositoId_key";

-- Agregar presentacionId
ALTER TABLE "stock_items"
  ADD COLUMN "presentacionId" TEXT;

-- FK para presentacionId
ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_presentacionId_fkey"
    FOREIGN KEY ("presentacionId") REFERENCES "producto_presentaciones"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nuevo unique (4 campos)
CREATE UNIQUE INDEX "stock_items_productoId_presentacionId_clienteId_depositoId_key"
  ON "stock_items"("productoId", "presentacionId", "clienteId", "depositoId");

-- Índice para el nuevo campo
CREATE INDEX "stock_items_tenantId_presentacionId_idx"
  ON "stock_items"("tenantId", "presentacionId");

-- ────────────────────────────────────────────────────────────────────────────
-- Actualizar productos
-- ────────────────────────────────────────────────────────────────────────────

-- Eliminar FKs de los campos de presentación
ALTER TABLE "productos" DROP CONSTRAINT IF EXISTS "productos_presentacion1Id_fkey";
ALTER TABLE "productos" DROP CONSTRAINT IF EXISTS "productos_presentacion2Id_fkey";

-- Eliminar columnas desnormalizadas
ALTER TABLE "productos"
  DROP COLUMN IF EXISTS "presentacion1Id",
  DROP COLUMN IF EXISTS "presentacion2Id",
  DROP COLUMN IF EXISTS "unidad1Nombre",
  DROP COLUMN IF EXISTS "unidad2Nombre";

-- Agregar pesoUnitarioKg
ALTER TABLE "productos"
  ADD COLUMN IF NOT EXISTS "pesoUnitarioKg" DOUBLE PRECISION;

-- ────────────────────────────────────────────────────────────────────────────
-- Actualizar trigger en movimientos_stock
-- clienteId ya no existe en movimientos_stock (pasó a stock_operaciones)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_movimiento_stock_refs_tenant_check ON "movimientos_stock";
DROP FUNCTION IF EXISTS trg_fn_movimiento_stock_refs_tenant_check;

CREATE OR REPLACE FUNCTION trg_fn_movimiento_stock_refs_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "productos"
    WHERE id = NEW."productoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en movimientos_stock.productoId: producto % no pertenece al tenant %',
      NEW."productoId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movimiento_stock_refs_tenant_check
  BEFORE INSERT OR UPDATE ON "movimientos_stock"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_movimiento_stock_refs_tenant_check();
