-- Backfill de países predefinidos para tenants sin ninguno (ej. creados después
-- del seed histórico 20260807181010_seed_paises_predefinidos, que solo cubrió
-- los tenants existentes en ese momento — la creación de tenants no quedó
-- disparando este seed hasta ahora). Idempotente: mismo criterio ON CONFLICT
-- DO NOTHING que el seed original, seguro de re-correr.
INSERT INTO "paises" ("id", "tenantId", "nombre", "codigo", "esPredefinido", "createdAt")
SELECT
  'pais_' || substr(md5(random()::text || t."clerkOrgId" || p.nombre), 1, 20),
  t."clerkOrgId",
  p.nombre,
  p.codigo,
  true,
  now()
FROM "tenants" t
CROSS JOIN (VALUES
  ('Argentina', 'AR'),
  ('Uruguay', 'UY'),
  ('Paraguay', 'PY'),
  ('Chile', 'CL'),
  ('Brasil', 'BR')
) AS p(nombre, codigo)
ON CONFLICT ("tenantId", "nombre") DO NOTHING;
