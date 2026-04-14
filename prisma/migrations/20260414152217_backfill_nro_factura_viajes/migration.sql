-- Backfill nro_factura para viajes que ya tienen factura_id asignado
UPDATE viajes
SET nro_factura = facturas.numero
FROM facturas
WHERE viajes.factura_id = facturas.id
  AND viajes.nro_factura IS NULL;
