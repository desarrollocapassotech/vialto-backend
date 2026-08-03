-- ArcaConfig pasa de un único par certPem/keyPem a un par por ambiente
-- (homologación y producción), ya que AFIP exige certificados distintos y no
-- intercambiables para cada uno. Se migran los valores existentes al slot de
-- producción: verificado (issuer "Computadores, AFIP" = CA de producción) que
-- los certificados hoy cargados en este entorno son certificados de producción.
ALTER TABLE "arca_configs" ADD COLUMN "certPemHomologacion" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN "keyPemHomologacion" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN "certPemProduccion" TEXT;
ALTER TABLE "arca_configs" ADD COLUMN "keyPemProduccion" TEXT;

UPDATE "arca_configs"
SET "certPemProduccion" = "certPem",
    "keyPemProduccion" = "keyPem"
WHERE "certPem" IS NOT NULL OR "keyPem" IS NOT NULL;

ALTER TABLE "arca_configs" DROP COLUMN "certPem";
ALTER TABLE "arca_configs" DROP COLUMN "keyPem";
