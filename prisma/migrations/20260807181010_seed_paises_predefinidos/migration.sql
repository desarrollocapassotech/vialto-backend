-- Seed de países predefinidos para tenants existentes
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