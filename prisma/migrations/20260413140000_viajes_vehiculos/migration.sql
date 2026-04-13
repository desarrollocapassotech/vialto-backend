-- Tabla N:N viaje ↔ vehículos (reemplaza vehiculoId + patentes en viajes)

CREATE TABLE "viajes_vehiculos" (
    "id" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "viajes_vehiculos_pkey" PRIMARY KEY ("id")
);

INSERT INTO "viajes_vehiculos" ("id", "viajeId", "vehiculoId", "orden")
SELECT
    substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 25),
    "id",
    "vehiculoId",
    0
FROM "viajes"
WHERE "vehiculoId" IS NOT NULL;

CREATE UNIQUE INDEX "viajes_vehiculos_viajeId_vehiculoId_key" ON "viajes_vehiculos"("viajeId", "vehiculoId");
CREATE INDEX "viajes_vehiculos_viajeId_idx" ON "viajes_vehiculos"("viajeId");
CREATE INDEX "viajes_vehiculos_vehiculoId_idx" ON "viajes_vehiculos"("vehiculoId");

ALTER TABLE "viajes_vehiculos" ADD CONSTRAINT "viajes_vehiculos_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viajes_vehiculos" ADD CONSTRAINT "viajes_vehiculos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "viajes" DROP CONSTRAINT IF EXISTS "viajes_vehiculoId_fkey";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "vehiculoId";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "patenteTractor";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "patenteSemirremolque";
