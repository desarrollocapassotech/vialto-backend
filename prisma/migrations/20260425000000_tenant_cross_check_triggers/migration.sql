-- M2: Triggers para validar consistencia de tenantId en FK cross-entity
-- PostgreSQL no permite CHECK constraints entre tablas, por lo que se usan triggers.

-- ─────────────────────────────────────────────────────────────────────────────
-- Función genérica reutilizable
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_tenant_fk(
  p_table text,
  p_id    text,
  p_tenant text
) RETURNS void AS $$
BEGIN
  IF p_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT id, "tenantId" FROM clientes
        UNION ALL SELECT id, "tenantId" FROM transportistas
        UNION ALL SELECT id, "tenantId" FROM facturas
        UNION ALL SELECT id, "tenantId" FROM remitos
      ) t
      WHERE t.id = p_id AND t."tenantId" = p_tenant
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch: registro % de tabla % no pertenece al tenant %',
        p_id, p_table, p_tenant;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- viajes: clienteId y facturaId deben pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_viaje_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."clienteId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'tenantId mismatch en viajes.clienteId: cliente % no pertenece al tenant %', NEW."clienteId", NEW."tenantId";
    END IF;
  END IF;
  IF NEW."facturaId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM facturas WHERE id = NEW."facturaId" AND "tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'tenantId mismatch en viajes.facturaId: factura % no pertenece al tenant %', NEW."facturaId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_viaje_tenant_check ON viajes;
CREATE TRIGGER trg_viaje_tenant_check
  BEFORE INSERT OR UPDATE ON viajes
  FOR EACH ROW EXECUTE FUNCTION trg_fn_viaje_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- facturas: clienteId y transportistaId deben pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_factura_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."clienteId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'tenantId mismatch en facturas.clienteId: cliente % no pertenece al tenant %', NEW."clienteId", NEW."tenantId";
    END IF;
  END IF;
  IF NEW."transportistaId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM transportistas WHERE id = NEW."transportistaId" AND "tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'tenantId mismatch en facturas.transportistaId: transportista % no pertenece al tenant %', NEW."transportistaId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_factura_tenant_check ON facturas;
CREATE TRIGGER trg_factura_tenant_check
  BEFORE INSERT OR UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION trg_fn_factura_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- pagos: facturaId debe pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_pago_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM facturas WHERE id = NEW."facturaId" AND "tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'tenantId mismatch en pagos.facturaId: factura % no pertenece al tenant %', NEW."facturaId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pago_tenant_check ON pagos;
CREATE TRIGGER trg_pago_tenant_check
  BEFORE INSERT OR UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION trg_fn_pago_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- movimientos_stock: remitoId debe pertenecer al mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_movimiento_stock_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."remitoId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM remitos WHERE id = NEW."remitoId" AND "tenantId" = NEW."tenantId") THEN
      RAISE EXCEPTION 'tenantId mismatch en movimientos_stock.remitoId: remito % no pertenece al tenant %', NEW."remitoId", NEW."tenantId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimiento_stock_tenant_check ON movimientos_stock;
CREATE TRIGGER trg_movimiento_stock_tenant_check
  BEFORE INSERT OR UPDATE ON movimientos_stock
  FOR EACH ROW EXECUTE FUNCTION trg_fn_movimiento_stock_tenant_check();
