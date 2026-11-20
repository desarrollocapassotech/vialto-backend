-- Proveedores tipo "otro" con un nombre de tipo propio de la empresa (ej. "Combustible").
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "categoria" TEXT;
