-- Align tenant maxUsers default with architecture decision.
ALTER TABLE "tenants"
ALTER COLUMN "maxUsers" SET DEFAULT 10;
