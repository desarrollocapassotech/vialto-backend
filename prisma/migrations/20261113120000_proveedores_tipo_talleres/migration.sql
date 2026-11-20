-- Proveedores de todo tipo (nov 2026). La tabla "transportistas" pasa a guardar cualquier
-- proveedor de la empresa, con `tipo`: transportista | taller | otro. Los talleres de
-- Mantenimiento dejan de ser una entidad propia: se migran como proveedores tipo "taller"
-- conservando su id, así las órdenes de trabajo siguen apuntando al mismo registro.

-- 1) El tipo deja de ser siempre "externo".
ALTER TABLE "transportistas" DROP CONSTRAINT IF EXISTS "transportistas_tipo_externo_check";
UPDATE "transportistas" SET "tipo" = 'transportista' WHERE "tipo" = 'externo';
ALTER TABLE "transportistas" ALTER COLUMN "tipo" SET DEFAULT 'transportista';
ALTER TABLE "transportistas" ADD CONSTRAINT "transportistas_tipo_check"
  CHECK ("tipo" IN ('transportista', 'taller', 'otro'));

-- 2) Desactivar en vez de borrar (antes solo lo tenían los talleres).
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "transportistas_tenantId_tipo_idx" ON "transportistas"("tenantId", "tipo");

-- 3) Talleres → proveedores tipo "taller" (mismo id).
INSERT INTO "transportistas" ("id", "tenantId", "nombre", "idFiscal", "telefono", "tipo", "activo", "pais", "createdAt")
SELECT t."id", t."tenantId", t."nombre", t."cuit", t."telefono", 'taller', t."activo",
       CASE WHEN t."cuit" IS NOT NULL THEN 'AR' ELSE NULL END,
       now()
FROM "talleres" t
ON CONFLICT ("id") DO NOTHING;

-- 4) La OT apunta a transportistas.
ALTER TABLE "ordenes_trabajo" DROP CONSTRAINT IF EXISTS "ordenes_trabajo_tallerId_fkey";
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_tallerId_fkey"
  FOREIGN KEY ("tallerId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION trg_fn_orden_trabajo_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "vehiculos"
    WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo.vehiculoId: vehículo % no pertenece al tenant %',
      NEW."vehiculoId", NEW."tenantId";
  END IF;
  IF NEW."tallerId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "transportistas"
      WHERE id = NEW."tallerId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo.tallerId: proveedor % no pertenece al tenant %',
        NEW."tallerId", NEW."tenantId";
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."vehiculoId" IS DISTINCT FROM OLD."vehiculoId" THEN
    IF EXISTS (
      SELECT 1 FROM "ordenes_trabajo_planes" otp
      JOIN "vehiculos_planes" vp ON vp.id = otp."vehiculoPlanId"
      WHERE otp."ordenId" = NEW.id AND vp."vehiculoId" <> NEW."vehiculoId"
    ) THEN
      RAISE EXCEPTION 'ordenes_trabajo %: no se puede cambiar el vehículo mientras cumpla planes de otro vehículo',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5) Fuera la tabla vieja.
DROP TABLE IF EXISTS "talleres";
