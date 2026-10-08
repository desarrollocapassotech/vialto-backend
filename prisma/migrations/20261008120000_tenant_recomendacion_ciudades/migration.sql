-- Switch por empresa: buscador/recomendación de ciudades en origen/destino de Viajes (default prendido).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "recomendacionCiudadesHabilitada" BOOLEAN NOT NULL DEFAULT true;
