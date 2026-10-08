-- Ajuste a `20261007160000_viaje_estado_borrador`: una factura sin emitir (arcaEstado
-- NULL) pero con `numero` cargado es un comprobante MANUAL (típicamente cargado antes de
-- que el tenant activara ARCA — con ARCA el número lo asigna AFIP al emitir y no se carga
-- a mano). No es un borrador: cuenta como facturada, igual que `mapFacturacionEstado`.

UPDATE viajes v
SET "facturacionEstado" = CASE WHEN f.estado = 'cobrada' THEN 'cobrado' ELSE 'facturado' END
FROM facturas f
WHERE f.id = v."facturaId"
  AND v."facturacionEstado" = 'borrador'
  AND f."arcaEstado" IS NULL
  AND NULLIF(TRIM(f.numero), '') IS NOT NULL;

UPDATE viajes_clientes vc
SET "facturacionEstado" = CASE WHEN f.estado = 'cobrada' THEN 'cobrado' ELSE 'facturado' END
FROM facturas f
WHERE f.id = vc."facturaId"
  AND vc."facturacionEstado" = 'borrador'
  AND f."arcaEstado" IS NULL
  AND NULLIF(TRIM(f.numero), '') IS NOT NULL;
