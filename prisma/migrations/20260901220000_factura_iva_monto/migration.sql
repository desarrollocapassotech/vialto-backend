-- IVA total persistido en facturas por tramo (tenants sin ARCA).
-- Null = no aplica / todavía no backfilleado. Idempotente.

ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "ivaMonto" DOUBLE PRECISION;
