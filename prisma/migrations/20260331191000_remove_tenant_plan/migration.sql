-- Remove deprecated plan column: subscription is module-based.
ALTER TABLE "tenants"
DROP COLUMN "plan";
