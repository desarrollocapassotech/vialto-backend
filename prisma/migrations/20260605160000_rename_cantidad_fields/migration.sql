-- Renombrar columnas de cantidad a nombres genéricos configurables
-- (no hay datos reales en las tablas de stock)

ALTER TABLE "movimientos_stock" RENAME COLUMN "cantidadPallets" TO "cantidad1";
ALTER TABLE "movimientos_stock" RENAME COLUMN "cantidadSuelto"  TO "cantidad2";

ALTER TABLE "stock_items" RENAME COLUMN "cantidadPallets" TO "cantidad1";
ALTER TABLE "stock_items" RENAME COLUMN "cantidadSuelto"  TO "cantidad2";
