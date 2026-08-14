-- Permite al superadmin ocultarle al admin del tenant la pantalla de import
-- masivo de Excel (el superadmin sigue pudiendo usarla desde su propio panel).
ALTER TABLE "tenants" ADD COLUMN "importacionesOcultas" BOOLEAN NOT NULL DEFAULT false;
