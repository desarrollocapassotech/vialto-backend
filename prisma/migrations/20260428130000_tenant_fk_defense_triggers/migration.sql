-- M: Triggers de defensa en profundidad para todas las FK cross-entidad sin cobertura DB
-- Estas FK ya tienen validación en la capa de servicio (assertXxx), pero sin trigger DB
-- un bug en un nuevo endpoint podría permitir cross-tenant writes silenciosos.

-- ─────────────────────────────────────────────────────────────────────────────
-- choferes.transportistaId → debe pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_chofer_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."transportistaId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "transportistas"
      WHERE id = NEW."transportistaId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en choferes.transportistaId: transportista % no pertenece al tenant %',
        NEW."transportistaId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chofer_tenant_check ON "choferes";
CREATE TRIGGER trg_chofer_tenant_check
  BEFORE INSERT OR UPDATE ON "choferes"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_chofer_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- vehiculos.transportistaId → debe pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_vehiculo_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."transportistaId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "transportistas"
      WHERE id = NEW."transportistaId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en vehiculos.transportistaId: transportista % no pertenece al tenant %',
        NEW."transportistaId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehiculo_tenant_check ON "vehiculos";
CREATE TRIGGER trg_vehiculo_tenant_check
  BEFORE INSERT OR UPDATE ON "vehiculos"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_vehiculo_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- movimientos_cuenta_corriente: clienteId y viajeId deben ser del mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_movimiento_cc_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "clientes"
    WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en movimientos_cuenta_corriente.clienteId: cliente % no pertenece al tenant %',
      NEW."clienteId", NEW."tenantId";
  END IF;
  IF NEW."viajeId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "viajes"
      WHERE id = NEW."viajeId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en movimientos_cuenta_corriente.viajeId: viaje % no pertenece al tenant %',
        NEW."viajeId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimiento_cc_tenant_check ON "movimientos_cuenta_corriente";
CREATE TRIGGER trg_movimiento_cc_tenant_check
  BEFORE INSERT OR UPDATE ON "movimientos_cuenta_corriente"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_movimiento_cc_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- cargas_combustible: vehiculoId y choferId deben ser del mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_carga_combustible_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "vehiculos"
    WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en cargas_combustible.vehiculoId: vehículo % no pertenece al tenant %',
      NEW."vehiculoId", NEW."tenantId";
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

DROP TRIGGER IF EXISTS trg_carga_combustible_tenant_check ON "cargas_combustible";
CREATE TRIGGER trg_carga_combustible_tenant_check
  BEFORE INSERT OR UPDATE ON "cargas_combustible"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_carga_combustible_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- intervenciones.vehiculoId → debe pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_intervencion_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "vehiculos"
    WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en intervenciones.vehiculoId: vehículo % no pertenece al tenant %',
      NEW."vehiculoId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intervencion_tenant_check ON "intervenciones";
CREATE TRIGGER trg_intervencion_tenant_check
  BEFORE INSERT OR UPDATE ON "intervenciones"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_intervencion_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- remitos: clienteId, choferId, vehiculoId deben ser del mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_remito_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "clientes"
    WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en remitos.clienteId: cliente % no pertenece al tenant %',
      NEW."clienteId", NEW."tenantId";
  END IF;
  IF NEW."choferId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "choferes"
      WHERE id = NEW."choferId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en remitos.choferId: chofer % no pertenece al tenant %',
        NEW."choferId", NEW."tenantId";
    END IF;
  END IF;
  IF NEW."vehiculoId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "vehiculos"
      WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en remitos.vehiculoId: vehículo % no pertenece al tenant %',
        NEW."vehiculoId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_remito_tenant_check ON "remitos";
CREATE TRIGGER trg_remito_tenant_check
  BEFORE INSERT OR UPDATE ON "remitos"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_remito_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- movimientos_stock: productoId y clienteId deben ser del mismo tenant
-- (remitoId ya tiene trigger de la migración 20260425000000)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_movimiento_stock_refs_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "productos"
    WHERE id = NEW."productoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en movimientos_stock.productoId: producto % no pertenece al tenant %',
      NEW."productoId", NEW."tenantId";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "clientes"
    WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en movimientos_stock.clienteId: cliente % no pertenece al tenant %',
      NEW."clienteId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimiento_stock_refs_tenant_check ON "movimientos_stock";
CREATE TRIGGER trg_movimiento_stock_refs_tenant_check
  BEFORE INSERT OR UPDATE ON "movimientos_stock"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_movimiento_stock_refs_tenant_check();
