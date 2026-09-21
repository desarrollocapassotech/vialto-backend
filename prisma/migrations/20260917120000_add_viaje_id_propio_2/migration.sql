-- Habilitación + label configurable de "ID Propio 2" por tenant (deshabilitado por defecto)
ALTER TABLE "tenants" ADD COLUMN "idPropio2Habilitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "idPropio2Label" TEXT DEFAULT 'ID Propio 2';

-- Segundo ID propio del viaje, opcional y NO único (a diferencia de numeroIdentificacionPersonalizado)
ALTER TABLE "viajes" ADD COLUMN "idPropio2" TEXT;
