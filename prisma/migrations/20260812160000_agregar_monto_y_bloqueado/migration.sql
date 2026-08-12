ALTER TABLE "conceptos_liquidacion" ADD COLUMN "bloqueado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conceptos_liquidacion" ADD COLUMN "monto" DOUBLE PRECISION;
