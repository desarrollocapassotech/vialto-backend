-- Intervencion.tipo (String) -> Intervencion.tipos (String[]), preservando datos existentes
ALTER TABLE "intervenciones" ADD COLUMN "tipos" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "intervenciones" SET "tipos" = ARRAY["tipo"];
ALTER TABLE "intervenciones" ALTER COLUMN "tipos" DROP DEFAULT;
ALTER TABLE "intervenciones" DROP COLUMN "tipo";
