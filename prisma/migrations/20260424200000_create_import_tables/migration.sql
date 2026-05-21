-- Crea las tablas del módulo de importaciones.
-- Usa IF NOT EXISTS para que sea seguro aplicar sobre una DB donde ya existan.

CREATE TABLE IF NOT EXISTS "import_templates" (
  "id"        TEXT          NOT NULL,
  "tenantId"  TEXT          NOT NULL,
  "modulo"    TEXT          NOT NULL,
  "nombre"    TEXT          NOT NULL,
  "config"    JSONB         NOT NULL DEFAULT '{}',
  "activo"    BOOLEAN       NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_templates_tenantId_modulo_key"
  ON "import_templates"("tenantId", "modulo");

CREATE INDEX IF NOT EXISTS "import_templates_tenantId_idx"
  ON "import_templates"("tenantId");

CREATE TABLE IF NOT EXISTS "import_sessions" (
  "id"            TEXT          NOT NULL,
  "tenantId"      TEXT          NOT NULL,
  "templateId"    TEXT          NOT NULL,
  "nombreArchivo" TEXT          NOT NULL,
  "filasValidas"  JSONB         NOT NULL DEFAULT '[]',
  "errores"       JSONB         NOT NULL DEFAULT '[]',
  "totalFilas"    INTEGER       NOT NULL,
  "expiresAt"     TIMESTAMP(3)  NOT NULL,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_sessions_tenantId_idx"
  ON "import_sessions"("tenantId");

CREATE TABLE IF NOT EXISTS "import_logs" (
  "id"            TEXT          NOT NULL,
  "tenantId"      TEXT          NOT NULL,
  "templateId"    TEXT,
  "modulo"        TEXT          NOT NULL,
  "nombreArchivo" TEXT          NOT NULL,
  "estado"        TEXT          NOT NULL DEFAULT 'completado',
  "totalFilas"    INTEGER       NOT NULL,
  "exitosas"      INTEGER       NOT NULL DEFAULT 0,
  "errores"       INTEGER       NOT NULL DEFAULT 0,
  "detalles"      JSONB         NOT NULL DEFAULT '[]',
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT          NOT NULL,
  CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_logs_tenantId_idx"
  ON "import_logs"("tenantId");

CREATE INDEX IF NOT EXISTS "import_logs_tenantId_modulo_idx"
  ON "import_logs"("tenantId", "modulo");
