ALTER TABLE "viajes"
ADD COLUMN "patenteTractor" TEXT,
ADD COLUMN "patenteSemirremolque" TEXT,
ADD COLUMN "fechaCarga" TIMESTAMP(3),
ADD COLUMN "fechaDescarga" TIMESTAMP(3);

UPDATE "viajes"
SET "fechaCarga" = "fechaSalida"
WHERE "fechaCarga" IS NULL
  AND "fechaSalida" IS NOT NULL;

UPDATE "viajes"
SET "fechaDescarga" = "fechaLlegada"
WHERE "fechaDescarga" IS NULL
  AND "fechaLlegada" IS NOT NULL;
