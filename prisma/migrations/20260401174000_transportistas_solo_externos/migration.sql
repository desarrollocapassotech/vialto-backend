-- Normaliza transportistas para eliminar ambigüedad: siempre externo.
UPDATE "transportistas"
SET "tipo" = 'externo'
WHERE "tipo" IS DISTINCT FROM 'externo';

ALTER TABLE "transportistas"
ALTER COLUMN "tipo" SET DEFAULT 'externo';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transportistas_tipo_externo_check'
  ) THEN
    ALTER TABLE "transportistas"
    DROP CONSTRAINT "transportistas_tipo_externo_check";
  END IF;

  ALTER TABLE "transportistas"
  ADD CONSTRAINT "transportistas_tipo_externo_check"
  CHECK ("tipo" = 'externo');
END
$$;
