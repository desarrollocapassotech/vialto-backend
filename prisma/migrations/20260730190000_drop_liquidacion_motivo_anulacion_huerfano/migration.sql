-- Elimina columnas huérfanas de la rama VTO-130 (nunca mergeada), reemplazadas por
-- el flujo de anulación vía nota de crédito 065 (ver 20260728190000_liquidacion_anulacion_nc065).
ALTER TABLE "liquidaciones" DROP COLUMN "motivoAnulacion";
ALTER TABLE "liquidaciones" DROP COLUMN "anuladoPor";
ALTER TABLE "liquidaciones" DROP COLUMN "anuladoAt";
