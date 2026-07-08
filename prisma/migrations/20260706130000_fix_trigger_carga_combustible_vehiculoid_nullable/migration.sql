-- Fix trg_fn_carga_combustible_tenant_check to allow vehiculoId = NULL
-- vehiculoId is now nullable (ON DELETE SET NULL); mirror the IS NOT NULL guard already used for choferId

CREATE OR REPLACE FUNCTION trg_fn_carga_combustible_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."vehiculoId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "vehiculos"
      WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en cargas_combustible.vehiculoId: vehículo % no pertenece al tenant %',
        NEW."vehiculoId", NEW."tenantId";
    END IF;
  END IF;
  IF NEW."choferId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "choferes"
      WHERE id = NEW."choferId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en cargas_combustible.choferId: chofer % no pertenece al tenant %',
        NEW."choferId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
