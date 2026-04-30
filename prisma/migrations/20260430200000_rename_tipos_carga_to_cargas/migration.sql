-- Renombra catálogo y FK en viajes: tipos_carga → cargas, tipoCargaId → cargaId

ALTER TABLE "tipos_carga" RENAME TO "cargas";

ALTER TABLE "cargas" RENAME CONSTRAINT "tipos_carga_pkey" TO "cargas_pkey";
ALTER TABLE "cargas" RENAME CONSTRAINT "tipos_carga_tenantId_fkey" TO "cargas_tenantId_fkey";

ALTER INDEX "tipos_carga_tenantId_nombreNormalizado_key" RENAME TO "cargas_tenantId_nombreNormalizado_key";
ALTER INDEX "tipos_carga_tenantId_idx" RENAME TO "cargas_tenantId_idx";
ALTER INDEX "tipos_carga_tenantId_activo_idx" RENAME TO "cargas_tenantId_activo_idx";

ALTER TABLE "viajes" RENAME COLUMN "tipoCargaId" TO "cargaId";

ALTER TABLE "viajes" RENAME CONSTRAINT "viajes_tipoCargaId_fkey" TO "viajes_cargaId_fkey";

ALTER INDEX "viajes_tenantId_tipoCargaId_idx" RENAME TO "viajes_tenantId_cargaId_idx";
