-- MANT-01-T1: reemplaza Intervencion por planes, talleres y órdenes de trabajo
-- (ver docs/mantenimiento-plan.md). Intervencion no tiene uso real: sin migración de datos.

-- DropForeignKey
ALTER TABLE "intervenciones" DROP CONSTRAINT "intervenciones_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "intervenciones" DROP CONSTRAINT "intervenciones_vehiculoId_fkey";

-- DropTable
DROP TABLE "intervenciones";

-- CreateTable
CREATE TABLE "planes_mantenimiento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipoVehiculo" TEXT,
    "intervaloKm" INTEGER,
    "intervaloDias" INTEGER,
    "intervaloHoras" INTEGER,
    "avisoKm" INTEGER,
    "avisoDias" INTEGER,
    "tareas" TEXT[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "planes_mantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos_planes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "baseKm" INTEGER,
    "baseFecha" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehiculos_planes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talleres" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "telefono" TEXT,
    "interno" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "talleres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_trabajo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'manual',
    "estado" TEXT NOT NULL DEFAULT 'cerrada',
    "tallerId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "km" INTEGER,
    "horas" DOUBLE PRECISION,
    "tareas" TEXT[],
    "descripcion" TEXT,
    "costoTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjuntos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ordenes_trabajo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_trabajo_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ordenId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'general',
    "descripcion" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "costoUnitario" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "productoId" TEXT,

    CONSTRAINT "ordenes_trabajo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_trabajo_planes" (
    "ordenId" TEXT NOT NULL,
    "vehiculoPlanId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ordenes_trabajo_planes_pkey" PRIMARY KEY ("ordenId","vehiculoPlanId")
);

-- CreateTable
CREATE TABLE "orden_trabajo_secuencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orden_trabajo_secuencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planes_mantenimiento_tenantId_idx" ON "planes_mantenimiento"("tenantId");

-- CreateIndex
CREATE INDEX "vehiculos_planes_tenantId_vehiculoId_idx" ON "vehiculos_planes"("tenantId", "vehiculoId");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_planes_tenantId_vehiculoId_planId_key" ON "vehiculos_planes"("tenantId", "vehiculoId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "talleres_tenantId_nombre_key" ON "talleres"("tenantId", "nombre");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_tenantId_vehiculoId_fecha_idx" ON "ordenes_trabajo"("tenantId", "vehiculoId", "fecha");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_tenantId_estado_idx" ON "ordenes_trabajo"("tenantId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_trabajo_tenantId_numero_key" ON "ordenes_trabajo"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_items_tenantId_ordenId_idx" ON "ordenes_trabajo_items"("tenantId", "ordenId");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_planes_tenantId_vehiculoPlanId_idx" ON "ordenes_trabajo_planes"("tenantId", "vehiculoPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "orden_trabajo_secuencias_tenantId_key" ON "orden_trabajo_secuencias"("tenantId");

-- AddForeignKey
ALTER TABLE "planes_mantenimiento" ADD CONSTRAINT "planes_mantenimiento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos_planes" ADD CONSTRAINT "vehiculos_planes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos_planes" ADD CONSTRAINT "vehiculos_planes_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos_planes" ADD CONSTRAINT "vehiculos_planes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "planes_mantenimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talleres" ADD CONSTRAINT "talleres_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_tallerId_fkey" FOREIGN KEY ("tallerId") REFERENCES "talleres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo_items" ADD CONSTRAINT "ordenes_trabajo_items_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo_planes" ADD CONSTRAINT "ordenes_trabajo_planes_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo_planes" ADD CONSTRAINT "ordenes_trabajo_planes_vehiculoPlanId_fkey" FOREIGN KEY ("vehiculoPlanId") REFERENCES "vehiculos_planes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_trabajo_secuencias" ADD CONSTRAINT "orden_trabajo_secuencias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- Triggers de defensa multi-tenant (mismo patrón que 20260428130000_tenant_fk_defense_triggers).
-- La validación principal vive en MantenimientoService; esto frena un cross-tenant write
-- si algún endpoint futuro se olvida de validar.
-- ═════════════════════════════════════════════════════════════════════════════

-- El trigger de intervenciones se fue con la tabla; la función quedaba huérfana.
DROP FUNCTION IF EXISTS trg_fn_intervencion_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- vehiculos_planes: vehiculoId y planId deben ser del mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_vehiculo_plan_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "vehiculos"
    WHERE id = NEW."vehiculoId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en vehiculos_planes.vehiculoId: vehículo % no pertenece al tenant %',
      NEW."vehiculoId", NEW."tenantId";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "planes_mantenimiento"
    WHERE id = NEW."planId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en vehiculos_planes.planId: plan % no pertenece al tenant %',
      NEW."planId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehiculo_plan_tenant_check ON "vehiculos_planes";
CREATE TRIGGER trg_vehiculo_plan_tenant_check
  BEFORE INSERT OR UPDATE ON "vehiculos_planes"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_vehiculo_plan_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- ordenes_trabajo: vehiculoId y tallerId deben ser del mismo tenant. Si cambia el
-- vehículo de una OT que ya cumple planes, esos planes tienen que ser del vehículo nuevo.
-- ─────────────────────────────────────────────────────────────────────────────
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
      SELECT 1 FROM "talleres"
      WHERE id = NEW."tallerId" AND "tenantId" = NEW."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo.tallerId: taller % no pertenece al tenant %',
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

DROP TRIGGER IF EXISTS trg_orden_trabajo_tenant_check ON "ordenes_trabajo";
CREATE TRIGGER trg_orden_trabajo_tenant_check
  BEFORE INSERT OR UPDATE ON "ordenes_trabajo"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_orden_trabajo_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- ordenes_trabajo_items: ordenId debe ser del mismo tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_orden_trabajo_item_tenant_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ordenes_trabajo"
    WHERE id = NEW."ordenId" AND "tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo_items.ordenId: orden % no pertenece al tenant %',
      NEW."ordenId", NEW."tenantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orden_trabajo_item_tenant_check ON "ordenes_trabajo_items";
CREATE TRIGGER trg_orden_trabajo_item_tenant_check
  BEFORE INSERT OR UPDATE ON "ordenes_trabajo_items"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_orden_trabajo_item_tenant_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- ordenes_trabajo_planes: orden y vehiculoPlan del mismo tenant, y del mismo vehículo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_orden_trabajo_plan_tenant_check()
RETURNS TRIGGER AS $$
DECLARE
  v_orden_vehiculo TEXT;
  v_plan_vehiculo  TEXT;
BEGIN
  SELECT "vehiculoId" INTO v_orden_vehiculo FROM "ordenes_trabajo"
  WHERE id = NEW."ordenId" AND "tenantId" = NEW."tenantId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo_planes.ordenId: orden % no pertenece al tenant %',
      NEW."ordenId", NEW."tenantId";
  END IF;
  SELECT "vehiculoId" INTO v_plan_vehiculo FROM "vehiculos_planes"
  WHERE id = NEW."vehiculoPlanId" AND "tenantId" = NEW."tenantId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenantId mismatch en ordenes_trabajo_planes.vehiculoPlanId: asignación % no pertenece al tenant %',
      NEW."vehiculoPlanId", NEW."tenantId";
  END IF;
  IF v_orden_vehiculo <> v_plan_vehiculo THEN
    RAISE EXCEPTION 'ordenes_trabajo_planes: la orden % y la asignación % son de vehículos distintos',
      NEW."ordenId", NEW."vehiculoPlanId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orden_trabajo_plan_tenant_check ON "ordenes_trabajo_planes";
CREATE TRIGGER trg_orden_trabajo_plan_tenant_check
  BEFORE INSERT OR UPDATE ON "ordenes_trabajo_planes"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_orden_trabajo_plan_tenant_check();
