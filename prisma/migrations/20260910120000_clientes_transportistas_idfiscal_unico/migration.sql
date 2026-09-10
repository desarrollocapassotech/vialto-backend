-- Un CUIT/DNI no puede pertenecer a dos clientes/transportistas/choferes del
-- mismo tenant. Esto ya se validaba a nivel de aplicación (ver
-- ClientesProcessor/TransportistasProcessor/ChoferesProcessor en
-- modules/importaciones), pero un caso real en producción (import del
-- 06/09/2026) demostró que ese chequeo solo, sin respaldo en la base, puede
-- fallar y dejar pasar un duplicado. Índice único parcial (no aplica a
-- idFiscal/dni vacío, que es un valor legítimo y repetible) como red de
-- seguridad final a nivel de base de datos.
CREATE UNIQUE INDEX "clientes_tenantId_idFiscal_key"
  ON "clientes" ("tenantId", "idFiscal")
  WHERE "idFiscal" IS NOT NULL AND "idFiscal" <> '';

CREATE UNIQUE INDEX "transportistas_tenantId_idFiscal_key"
  ON "transportistas" ("tenantId", "idFiscal")
  WHERE "idFiscal" IS NOT NULL AND "idFiscal" <> '';

CREATE UNIQUE INDEX "choferes_tenantId_dni_key"
  ON "choferes" ("tenantId", "dni")
  WHERE "dni" IS NOT NULL AND "dni" <> '';
