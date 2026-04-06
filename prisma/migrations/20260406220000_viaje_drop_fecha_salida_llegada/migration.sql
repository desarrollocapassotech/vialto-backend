-- Dejan de usarse en producto; se eliminan columnas.
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "fechaSalida";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "fechaLlegada";
