-- Liquidacion.ambiente existe en schema.prisma desde la feature de anulación CVLP
-- (commit "anulacion de cvlp") pero nunca se migró la tabla "liquidaciones".
-- Sin esta columna, cualquier SELECT/UPDATE sobre Liquidacion falla con
-- "column ambiente does not exist" (bug: listado de Liquidaciones no carga).
ALTER TABLE "liquidaciones" ADD COLUMN "ambiente" TEXT;
