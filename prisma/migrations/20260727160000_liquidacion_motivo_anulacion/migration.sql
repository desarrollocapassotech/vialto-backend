-- Motivo y auditoría de anulación de liquidaciones CVLP
ALTER TABLE "liquidaciones" ADD COLUMN "motivoAnulacion" TEXT;
ALTER TABLE "liquidaciones" ADD COLUMN "anuladoPor" TEXT;
ALTER TABLE "liquidaciones" ADD COLUMN "anuladoAt" TIMESTAMP(3);
