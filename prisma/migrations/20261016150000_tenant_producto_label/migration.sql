-- Label personalizado de "Producto" por tenant + columna Productos opcional en la grilla de Viajes.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "viajesColumnaProductosHabilitada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "productoLabel" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "productoLabelPlural" TEXT;
