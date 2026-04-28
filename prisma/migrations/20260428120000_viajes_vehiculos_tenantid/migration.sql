-- M: Agregar tenantId a viajes_vehiculos para garantizar aislamiento multi-tenant
-- Sin tenantId la tabla era un riesgo: queries por vehiculoId devolvían filas cross-tenant.

-- 1. Agregar columna (nullable mientras backfill)
ALTER TABLE "viajes_vehiculos" ADD COLUMN "tenantId" TEXT;

-- 2. Backfill desde el viaje padre
UPDATE "viajes_vehiculos" vv
SET "tenantId" = v."tenantId"
FROM "viajes" v
WHERE v.id = vv."viajeId";

-- 3. NOT NULL una vez backfilleado
ALTER TABLE "viajes_vehiculos" ALTER COLUMN "tenantId" SET NOT NULL;

-- 4. Índice por tenantId
CREATE INDEX "viajes_vehiculos_tenantId_idx" ON "viajes_vehiculos"("tenantId");

-- 5. Trigger: vehiculoId debe pertenecer al mismo tenant
CREATE OR REPLACE FUNCTION trg_fn_viaje_vehiculo_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "vehiculos"
    WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en viajes_vehiculos.vehiculoId: vehículo % no pertenece al tenant %',
      NEW."vehiculoId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_viaje_vehiculo_tenant_check ON "viajes_vehiculos";
CREATE TRIGGER trg_viaje_vehiculo_tenant_check
  BEFORE INSERT OR UPDATE ON "viajes_vehiculos"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_viaje_vehiculo_tenant_check();
