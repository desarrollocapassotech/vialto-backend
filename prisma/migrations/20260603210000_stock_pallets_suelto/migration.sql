-- Reemplazar Presentaciones por cantidadPallets + cantidadSuelto en el módulo de stock.
-- 1. Drops de FK hacia presentaciones (deben ir antes de eliminar la tabla)
-- 2. Eliminar columnas presentacionId y cantidad; agregar cantidadPallets y cantidadSuelto
-- 3. Ajustar unique constraint de stock_items
-- 4. Eliminar tabla presentaciones

-- Paso 1: Eliminar FK de movimientos_stock → presentaciones
ALTER TABLE "movimientos_stock" DROP CONSTRAINT IF EXISTS "movimientos_stock_presentacionId_fkey";

-- Paso 2: Eliminar FK de stock_items → presentaciones
ALTER TABLE "stock_items" DROP CONSTRAINT IF EXISTS "stock_items_presentacionId_fkey";

-- Paso 3: Eliminar índice de presentacionId en movimientos_stock
DROP INDEX IF EXISTS "movimientos_stock_tenantId_presentacionId_idx";

-- Paso 4: Eliminar unique constraint de stock_items (incluye presentacionId)
ALTER TABLE "stock_items" DROP CONSTRAINT IF EXISTS "stock_items_productoId_presentacionId_clienteId_key";

-- Paso 5: Cambios en movimientos_stock
--   · Eliminar columna presentacionId
--   · Renombrar cantidad a cantidadSuelto (migra data existente)
--   · Agregar cantidadPallets con default 0
ALTER TABLE "movimientos_stock" DROP COLUMN IF EXISTS "presentacionId";
ALTER TABLE "movimientos_stock" RENAME COLUMN "cantidad" TO "cantidadSuelto";
ALTER TABLE "movimientos_stock" ALTER COLUMN "cantidadSuelto" SET DEFAULT 0;
ALTER TABLE "movimientos_stock" ADD COLUMN "cantidadPallets" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Paso 6: Cambios en stock_items
--   · Eliminar columna presentacionId
--   · Renombrar cantidad a cantidadSuelto (migra data existente)
--   · Agregar cantidadPallets con default 0
ALTER TABLE "stock_items" DROP COLUMN IF EXISTS "presentacionId";
ALTER TABLE "stock_items" RENAME COLUMN "cantidad" TO "cantidadSuelto";
ALTER TABLE "stock_items" ALTER COLUMN "cantidadSuelto" SET DEFAULT 0;
ALTER TABLE "stock_items" ADD COLUMN "cantidadPallets" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Paso 7: Nueva unique constraint en stock_items (sin presentacionId)
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_productoId_clienteId_key" UNIQUE ("productoId", "clienteId");

-- Paso 8: Eliminar tabla presentaciones
DROP TABLE IF EXISTS "presentaciones";
