-- CreateTable
CREATE TABLE "viajes_destinos" (
    "id"        TEXT         NOT NULL,
    "tenantId"  TEXT         NOT NULL,
    "viajeId"   TEXT         NOT NULL,
    "orden"     INTEGER      NOT NULL DEFAULT 0,
    "etiqueta"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viajes_destinos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "viajes_destinos_viajeId_orden_key" ON "viajes_destinos"("viajeId", "orden");

-- CreateIndex
CREATE INDEX "viajes_destinos_tenantId_idx" ON "viajes_destinos"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_destinos_viajeId_idx" ON "viajes_destinos"("viajeId");

-- AddForeignKey
ALTER TABLE "viajes_destinos" ADD CONSTRAINT "viajes_destinos_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
