-- La unidad de cantidad pasó a usarse también en Liquidación (CVLP/Contrato) y Viajes,
-- no solo en Factura — se renombra para reflejarlo.
ALTER TABLE "tenants" RENAME COLUMN "facturaCantidadUnidad" TO "unidadCantidadViajes";
