-- Vencimiento de la intervención por fecha (opcional), en paralelo a "proximoKm".
ALTER TABLE "intervenciones" ADD COLUMN "proximaFecha" TIMESTAMP(3);
