-- AlterTable: agregar nombres configurables de unidades al modelo Producto
ALTER TABLE "productos" ADD COLUMN "unidad1Nombre" TEXT NOT NULL DEFAULT 'Pallets';
ALTER TABLE "productos" ADD COLUMN "unidad2Nombre" TEXT DEFAULT 'Unidad';

-- Poblar registros existentes con los defaults visuales
UPDATE "productos" SET "unidad2Nombre" = 'Unidad' WHERE "unidad2Nombre" IS NULL;
