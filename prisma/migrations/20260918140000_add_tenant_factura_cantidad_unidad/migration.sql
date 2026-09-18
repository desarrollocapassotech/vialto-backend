-- Unidad de la columna "Cantidad" en el PDF de factura A/B (ARCA) — 'TN' (default) | 'UD'
ALTER TABLE "tenants" ADD COLUMN "facturaCantidadUnidad" TEXT NOT NULL DEFAULT 'TN';
