-- En homologación se usa el CUIT de prueba de AFIP SDK sin certificado propio
-- (ver CUIT_TEST_HOMOLOGACION en arca.util.ts), así que el slot de certificado
-- de homologación quedó sin uso. Solo el de producción sigue siendo necesario.
ALTER TABLE "arca_configs" DROP COLUMN IF EXISTS "certPemHomologacion";
ALTER TABLE "arca_configs" DROP COLUMN IF EXISTS "keyPemHomologacion";
