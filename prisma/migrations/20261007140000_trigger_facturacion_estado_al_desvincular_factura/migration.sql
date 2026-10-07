-- Red de seguridad: cuando un viaje (o un cliente-tramo de un viaje multi-cliente)
-- pierde su factura, `facturacionEstado` vuelve a 'sin_facturar'.
--
-- La app ya lo recalcula (`syncFacturacionEstadoViaje`), pero si una factura se borra
-- por fuera de la app (SQL directo, consola de Neon, scripts de limpieza), el
-- `ON DELETE SET NULL` de la FK deja `facturaId` en NULL sin pasar por ese recálculo y
-- el viaje queda mostrando "Facturado"/"Error de AFIP" sin factura (bug real oct 2026:
-- 32 viajes huérfanos en develop). Postgres dispara los triggers de usuario también
-- en las acciones referenciales, así que esto cubre ambos caminos.
--
-- Sin factura, el estado correcto es siempre 'sin_facturar' (mismo resultado que
-- `mapFacturacionEstado(null, ...)` en el backend), así que no pisa nada de la app.

CREATE OR REPLACE FUNCTION trg_fn_facturacion_estado_sin_factura()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."facturaId" IS NULL AND OLD."facturaId" IS NOT NULL THEN
    NEW."facturacionEstado" := 'sin_facturar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_viaje_facturacion_estado_sin_factura ON viajes;
CREATE TRIGGER trg_viaje_facturacion_estado_sin_factura
  BEFORE UPDATE OF "facturaId" ON viajes
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_facturacion_estado_sin_factura();

DROP TRIGGER IF EXISTS trg_viaje_cliente_facturacion_estado_sin_factura ON viajes_clientes;
CREATE TRIGGER trg_viaje_cliente_facturacion_estado_sin_factura
  BEFORE UPDATE OF "facturaId" ON viajes_clientes
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_facturacion_estado_sin_factura();

-- Backfill: viajes que ya quedaron huérfanos antes de este trigger.
UPDATE viajes v
SET "facturacionEstado" = 'sin_facturar'
WHERE v."facturacionEstado" <> 'sin_facturar'
  AND v."facturaId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM viajes_clientes vc WHERE vc."viajeId" = v.id);

UPDATE viajes_clientes
SET "facturacionEstado" = 'sin_facturar'
WHERE "facturacionEstado" <> 'sin_facturar'
  AND "facturaId" IS NULL;
