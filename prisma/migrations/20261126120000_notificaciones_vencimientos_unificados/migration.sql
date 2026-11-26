-- Notificaciones: un solo aviso de vencimientos (nov 2026).
-- Reemplaza a 'facturacion.facturaPorVencer', 'facturacion.facturaVencida' y
-- 'cuenta-corriente.vencimiento' por 'vencimientos'. Una empresa con Facturación y Cuenta corriente
-- recibía dos mails por la misma factura (cada factura de cliente es también una venta en CC).
-- Idempotente: se puede volver a correr sin duplicar nada.

-- 1) Ruta de la app por aviso (click en la campana y en el email).
ALTER TABLE "notificacion_envios" ADD COLUMN IF NOT EXISTS "url" TEXT;

-- 2) Configuración: un registro 'vencimientos' por empresa que había tocado alguno de los tres.
--    Activo si alguno de los tipos que aplicaban a la empresa estaba activo (sin registro = default
--    activo). Destinatarios: si alguno usaba el default (todos los admins), queda el default; si
--    todos tenían una lista, la unión (nadie que recibía el aviso deja de recibirlo).
WITH tipos AS (
  SELECT t."clerkOrgId" AS "tenantId", x.tipo
  FROM "tenants" t
  CROSS JOIN unnest(ARRAY[
    'facturacion.facturaPorVencer', 'facturacion.facturaVencida', 'cuenta-corriente.vencimiento'
  ]) AS x(tipo)
  WHERE (x.tipo LIKE 'facturacion.%' AND 'facturacion' = ANY(t."modules"))
     OR (x.tipo = 'cuenta-corriente.vencimiento' AND 'cuenta-corriente' = ANY(t."modules"))
),
efectivo AS (
  SELECT tp."tenantId",
         c.tipo IS NOT NULL                AS "tieneRegistro",
         COALESCE(c."activo", true)        AS "activo",
         COALESCE(c."destinatarios", '{}') AS "destinatarios"
  FROM tipos tp
  LEFT JOIN "notificacion_configs" c ON c."tenantId" = tp."tenantId" AND c.tipo = tp.tipo
),
agregado AS (
  SELECT e."tenantId",
         bool_or(e."activo") AS "activo",
         CASE WHEN bool_or(cardinality(e."destinatarios") = 0) THEN '{}'::text[]
              ELSE ARRAY(SELECT DISTINCT d FROM efectivo e2, unnest(e2."destinatarios") d
                         WHERE e2."tenantId" = e."tenantId" ORDER BY d)
         END AS "destinatarios"
  FROM efectivo e
  GROUP BY e."tenantId"
  HAVING bool_or(e."tieneRegistro")
)
INSERT INTO "notificacion_configs" ("id", "tenantId", "tipo", "activo", "destinatarios", "updatedBy", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || a."tenantId"),
       a."tenantId", 'vencimientos', a."activo", a."destinatarios", 'migracion-vencimientos', now()
FROM agregado a
ON CONFLICT ("tenantId", "tipo") DO NOTHING;

-- 3) Historial (campana + dedup). El aviso nuevo usa entidadId 'id:por-vencer' / 'id:vencido', con
--    el id del movimiento de CC si la empresa tiene Cuenta corriente, si no el de la factura. Así lo
--    que ya se avisó no se vuelve a mandar. Si la misma factura se había avisado por los dos tipos,
--    queda un solo registro (ON CONFLICT).
WITH viejos AS (
  SELECT e.*,
         CASE WHEN e.tipo = 'facturacion.facturaVencida' THEN 'vencido' ELSE 'por-vencer' END AS sufijo,
         'cuenta-corriente' = ANY(t."modules") AS "tieneCc"
  FROM "notificacion_envios" e
  JOIN "tenants" t ON t."clerkOrgId" = e."tenantId"
  WHERE e.tipo IN ('facturacion.facturaPorVencer', 'facturacion.facturaVencida', 'cuenta-corriente.vencimiento')
),
mapeados AS (
  SELECT v.*,
         m."id" AS "movId",
         m."clienteId" AS "movClienteId",
         m."contraparteId" AS "movContraparteId"
  FROM viejos v
  LEFT JOIN "movimientos_cuenta_corriente" m
    ON m."tenantId" = v."tenantId"
   AND (
     (v.tipo = 'cuenta-corriente.vencimiento' AND m."id" = v."entidadId")
     OR (v.tipo <> 'cuenta-corriente.vencimiento' AND v."tieneCc" AND m."facturaId" = v."entidadId"
         AND m."tipo" = 'cargo')
   )
)
INSERT INTO "notificacion_envios"
  ("id", "tenantId", "tipo", "entidadId", "titulo", "detalle", "url", "destinatarios", "leidoPor", "enviadoAt")
SELECT md5(random()::text || clock_timestamp()::text || mp."id"),
       mp."tenantId",
       'vencimientos',
       COALESCE(mp."movId", mp."entidadId") || ':' || mp.sufijo,
       mp."titulo",
       mp."detalle",
       CASE
         WHEN mp."movId" IS NOT NULL THEN
           '/cuenta-corriente?tipo=' || CASE WHEN mp."movClienteId" IS NOT NULL THEN 'cliente' ELSE 'proveedor' END
           || '&id=' || mp."movContraparteId"
         WHEN mp.tipo <> 'cuenta-corriente.vencimiento' THEN '/facturacion?factura=' || mp."entidadId"
         ELSE NULL
       END,
       mp."destinatarios",
       mp."leidoPor",
       mp."enviadoAt"
FROM mapeados mp
ORDER BY mp."enviadoAt"
ON CONFLICT ("tenantId", "tipo", "entidadId") DO NOTHING;

DELETE FROM "notificacion_envios"
WHERE tipo IN ('facturacion.facturaPorVencer', 'facturacion.facturaVencida', 'cuenta-corriente.vencimiento');

DELETE FROM "notificacion_configs"
WHERE tipo IN ('facturacion.facturaPorVencer', 'facturacion.facturaVencida', 'cuenta-corriente.vencimiento');
