-- Viaje: una o más cargas (tabla puente). Migra datos desde viajes.cargaId.

CREATE TABLE "viajes_cargas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "cargaId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "viajes_cargas_pkey" PRIMARY KEY ("id")
);

INSERT INTO "viajes_cargas" ("id", "tenantId", "viajeId", "cargaId", "orden")
SELECT gen_random_uuid()::text, v."tenantId", v."id", v."cargaId", 0
FROM "viajes" v
WHERE v."cargaId" IS NOT NULL AND btrim(v."cargaId") <> '';

ALTER TABLE "viajes" DROP CONSTRAINT IF EXISTS "viajes_cargaId_fkey";
DROP INDEX IF EXISTS "viajes_tenantId_cargaId_idx";
ALTER TABLE "viajes" DROP COLUMN "cargaId";

ALTER TABLE "viajes_cargas" ADD CONSTRAINT "viajes_cargas_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viajes_cargas" ADD CONSTRAINT "viajes_cargas_cargaId_fkey" FOREIGN KEY ("cargaId") REFERENCES "cargas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "viajes_cargas_viajeId_cargaId_key" ON "viajes_cargas"("viajeId", "cargaId");
CREATE INDEX "viajes_cargas_tenantId_idx" ON "viajes_cargas"("tenantId");
CREATE INDEX "viajes_cargas_viajeId_idx" ON "viajes_cargas"("viajeId");
CREATE INDEX "viajes_cargas_cargaId_idx" ON "viajes_cargas"("cargaId");
