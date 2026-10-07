-- Nuevo estado "borrador" en `facturacionEstado` / `liquidacionEstado` del viaje (solo
-- tenants con ARCA): el viaje tiene un comprobante vinculado que todavía no se emitió.
-- Antes una factura borrador dejaba el viaje en 'sin_facturar' (y la grilla ofrecía
-- "Facturar" de nuevo) y una liquidación borrador lo dejaba en 'esperando_afip' (como si
-- ya se hubiera mandado a AFIP). Ver `mapFacturacionEstado` / `mapLiquidacionEstado` en
-- `viaje-estado-financiero.ts`. Las columnas son texto libre: no hay enum que alterar,
-- solo recalcular los viajes existentes con la misma lógica del backend.

-- Facturación: factura vinculada sin intento de emisión (arcaEstado NULL).
UPDATE viajes v
SET "facturacionEstado" = 'borrador'
FROM facturas f, tenants t
WHERE f.id = v."facturaId"
  AND t."clerkOrgId" = v."tenantId"
  AND 'emision-facturas-arca' = ANY (t.modules)
  AND f."arcaEstado" IS NULL
  AND v."facturacionEstado" = 'sin_facturar';

UPDATE viajes_clientes vc
SET "facturacionEstado" = 'borrador'
FROM facturas f, tenants t
WHERE f.id = vc."facturaId"
  AND t."clerkOrgId" = vc."tenantId"
  AND 'emision-facturas-arca' = ANY (t.modules)
  AND f."arcaEstado" IS NULL
  AND vc."facturacionEstado" = 'sin_facturar';

-- Liquidación: la liquidación "elegida" del viaje (la activa más reciente, mismo criterio
-- que `syncLiquidacionEstadoViaje`) sigue en borrador.
UPDATE viajes v
SET "liquidacionEstado" = 'borrador'
FROM tenants t
WHERE t."clerkOrgId" = v."tenantId"
  AND 'emision-liquido-producto-arca' = ANY (t.modules)
  AND v."liquidacionEstado" = 'esperando_afip'
  AND (
    SELECT l.estado
    FROM liquidacion_viajes lv
    JOIN liquidaciones l ON l.id = lv."liquidacionId"
    WHERE lv."viajeId" = v.id
      AND l.estado <> 'anulado'
    ORDER BY l."updatedAt" DESC
    LIMIT 1
  ) = 'borrador';
