-- Catálogo de tipos de intervención ampliado (motor/frenos/tren motriz/eléctrico/carga-acople/neumáticos).
-- Remapea los slugs viejos y genéricos a sus equivalentes nuevos más específicos;
-- "service" no tiene un equivalente directo en el catálogo nuevo, cae a "otro".
UPDATE "intervenciones"
SET "tipos" = array_replace(
  array_replace(
    array_replace(
      array_replace("tipos", 'aceite', 'cambio_aceite_motor'),
      'filtro', 'revision_filtros'
    ),
    'cubiertas', 'cambio_cubiertas'
  ),
  'service', 'otro'
);
