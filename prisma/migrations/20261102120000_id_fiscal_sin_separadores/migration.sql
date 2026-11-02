-- CUIT / ID fiscal sin guiones, puntos ni espacios (ver normalizarIdFiscal en
-- shared/util/documento-unico.util.ts): desde ahora se guarda así y se formatea
-- solo al mostrar. Con formatos mezclados ("30-67863361-1" y "30678633611") la
-- validación de duplicados no los reconocía como el mismo y se cargaban dos veces;
-- normalizado, el índice único (tenantId, idFiscal) también los frena.
--
-- Solo datos, idempotente. Si dos registros del mismo tenant quedarían con el mismo
-- ID fiscal (duplicados ya existentes), no se tocan para no romper el índice único:
-- hay que unificarlos a mano y la normalización los toma en la próxima edición.
-- El DNI del chofer no se toca: lo usa el login de la app de combustible tal cual.

UPDATE "clientes" c
SET "idFiscal" = NULLIF(upper(regexp_replace(c."idFiscal", '[^0-9A-Za-z]', '', 'g')), '')
WHERE c."idFiscal" IS NOT NULL
  AND c."idFiscal" !~ '^[0-9A-Z]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "clientes" o
    WHERE o."tenantId" = c."tenantId"
      AND o.id <> c.id
      AND upper(regexp_replace(o."idFiscal", '[^0-9A-Za-z]', '', 'g'))
        = upper(regexp_replace(c."idFiscal", '[^0-9A-Za-z]', '', 'g'))
  );

UPDATE "transportistas" t
SET "idFiscal" = NULLIF(upper(regexp_replace(t."idFiscal", '[^0-9A-Za-z]', '', 'g')), '')
WHERE t."idFiscal" IS NOT NULL
  AND t."idFiscal" !~ '^[0-9A-Z]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "transportistas" o
    WHERE o."tenantId" = t."tenantId"
      AND o.id <> t.id
      AND upper(regexp_replace(o."idFiscal", '[^0-9A-Za-z]', '', 'g'))
        = upper(regexp_replace(t."idFiscal", '[^0-9A-Za-z]', '', 'g'))
  );

-- Sin índice único sobre el CUIT del chofer: se normalizan todos.
UPDATE "choferes"
SET "cuit" = NULLIF(upper(regexp_replace("cuit", '[^0-9A-Za-z]', '', 'g')), '')
WHERE "cuit" IS NOT NULL AND "cuit" !~ '^[0-9A-Z]+$';
