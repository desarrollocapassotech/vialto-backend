-- La migración 20260428130000_tenant_fk_defense_triggers creó este trigger cuando
-- `clienteId` era obligatorio. Desde que Cuenta Corriente soporta proveedores
-- (clienteId nullable, proveedorId nuevo), la fila de un cargo a proveedor tiene
-- clienteId = NULL, y el chequeo original ("cliente NO existe con ese id en el
-- tenant") rechazaba de forma incorrecta CUALQUIER clienteId nulo — bloqueando por
-- completo la creación de cargos de proveedor. Se agrega el mismo guard NULL que ya
-- tenía viajeId, y se suma el chequeo análogo para proveedorId (contra
-- transportistas), que nunca existió.
CREATE OR REPLACE FUNCTION trg_fn_movimiento_cc_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."clienteId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "clientes"
      WHERE id = NEW."clienteId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en movimientos_cuenta_corriente.clienteId: cliente % no pertenece al tenant %',
        NEW."clienteId", NEW."tenantId";
    END IF;
  END IF;
  IF NEW."proveedorId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "transportistas"
      WHERE id = NEW."proveedorId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en movimientos_cuenta_corriente.proveedorId: proveedor % no pertenece al tenant %',
        NEW."proveedorId", NEW."tenantId";
    END IF;
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
