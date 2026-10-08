-- Marca de "validado contra el padrón de ARCA" en clientes y transportistas (core/padron).
-- Huella "cuit|condicionIva|domicilio" de los datos validados: si cambian, se vuelve a consultar.
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "arcaValidadoHuella" TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "arcaValidadoAt" TIMESTAMP(3);
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "arcaValidadoHuella" TEXT;
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "arcaValidadoAt" TIMESTAMP(3);
