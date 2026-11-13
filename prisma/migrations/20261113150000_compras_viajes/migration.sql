-- Compra manual de Cuenta corriente vinculada (opcional) a uno o varios viajes, con la parte
-- del importe neto que le toca a cada uno (nov 2026).
CREATE TABLE IF NOT EXISTS "compras_viajes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "movimientoId" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compras_viajes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "compras_viajes_movimientoId_viajeId_key" ON "compras_viajes"("movimientoId", "viajeId");
CREATE INDEX IF NOT EXISTS "compras_viajes_tenantId_viajeId_idx" ON "compras_viajes"("tenantId", "viajeId");

ALTER TABLE "compras_viajes" ADD CONSTRAINT "compras_viajes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compras_viajes" ADD CONSTRAINT "compras_viajes_movimientoId_fkey"
  FOREIGN KEY ("movimientoId") REFERENCES "movimientos_cuenta_corriente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compras_viajes" ADD CONSTRAINT "compras_viajes_viajeId_fkey"
  FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defensa multi-tenant: la compra y el viaje tienen que ser de la misma empresa que el vínculo.
CREATE OR REPLACE FUNCTION trg_fn_compra_viaje_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "movimientos_cuenta_corriente"
    WHERE id = NEW."movimientoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en compras_viajes.movimientoId: % no pertenece al tenant %',
      NEW."movimientoId", NEW."tenantId";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "viajes"
    WHERE id = NEW."viajeId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en compras_viajes.viajeId: % no pertenece al tenant %',
      NEW."viajeId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compra_viaje_tenant_check ON "compras_viajes";
CREATE TRIGGER trg_compra_viaje_tenant_check
  BEFORE INSERT OR UPDATE ON "compras_viajes"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_compra_viaje_tenant_check();
