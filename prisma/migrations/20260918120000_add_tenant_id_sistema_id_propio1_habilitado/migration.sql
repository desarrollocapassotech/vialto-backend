-- Habilitación (visualización) de "ID Sistema" y "ID Propio 1" en Viajes, por tenant — ambos default true (comportamiento actual, siempre visibles)
ALTER TABLE "tenants" ADD COLUMN "idSistemaHabilitado" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "idPropio1Habilitado" BOOLEAN NOT NULL DEFAULT true;
