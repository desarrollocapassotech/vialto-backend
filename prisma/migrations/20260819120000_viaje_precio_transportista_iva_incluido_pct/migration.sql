-- Reemplaza el boolean precioTransportistaIncluyeIva por un % (precioTransportistaIvaIncluidoPct).
-- Antes: el flag excluía mutuamente al viaje de cualquier Liquidación ARCA/CVLP (rechazado
-- con error). Ahora: el % permite "netear" el precio (dividir por 1 + pct/100) antes de
-- sumarlo al bruto de la Liquidación, para que el CVLP no vuelva a aplicar el IVA que ya
-- estaba incluido — el viaje se puede liquidar igual, en vez de bloquearse.
-- Sin dato de producción en juego (la columna vieja nunca llegó a producción).
ALTER TABLE "viajes" DROP COLUMN "precioTransportistaIncluyeIva";
ALTER TABLE "viajes" ADD COLUMN "precioTransportistaIvaIncluidoPct" DOUBLE PRECISION NOT NULL DEFAULT 0;
