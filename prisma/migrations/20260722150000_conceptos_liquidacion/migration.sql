-- Catálogo de conceptos de liquidación CVLP (por tenant) + líneas por liquidación
CREATE TABLE "conceptos_liquidacion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "signo" TEXT NOT NULL,
    "ivaPct" DOUBLE PRECISION NOT NULL DEFAULT 21,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conceptos_liquidacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "liquidacion_concepto_lineas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "conceptoLiquidacionId" TEXT,
    "nombreSnapshot" TEXT NOT NULL,
    "signo" TEXT NOT NULL,
    "ivaPct" DOUBLE PRECISION NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_concepto_lineas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conceptos_liquidacion_tenantId_activo_idx" ON "conceptos_liquidacion"("tenantId", "activo");
CREATE INDEX "liquidacion_concepto_lineas_liquidacionId_idx" ON "liquidacion_concepto_lineas"("liquidacionId");
CREATE INDEX "liquidacion_concepto_lineas_tenantId_idx" ON "liquidacion_concepto_lineas"("tenantId");

ALTER TABLE "conceptos_liquidacion" ADD CONSTRAINT "conceptos_liquidacion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liquidacion_concepto_lineas" ADD CONSTRAINT "liquidacion_concepto_lineas_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liquidacion_concepto_lineas" ADD CONSTRAINT "liquidacion_concepto_lineas_conceptoLiquidacionId_fkey" FOREIGN KEY ("conceptoLiquidacionId") REFERENCES "conceptos_liquidacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
