-- CreateTable
CREATE TABLE "public"."tenant_field_config_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "formulario" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "configAnterior" JSONB,
    "configNuevo" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_field_config_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_field_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "formulario" TEXT NOT NULL,
    "campos" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "tenant_field_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_field_config_audit_logs_changedAt_idx" ON "public"."tenant_field_config_audit_logs"("changedAt" DESC);

-- CreateIndex
CREATE INDEX "tenant_field_config_audit_logs_tenantId_idx" ON "public"."tenant_field_config_audit_logs"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "tenant_field_config_audit_logs_tenantId_modulo_formulario_idx" ON "public"."tenant_field_config_audit_logs"("tenantId" ASC, "modulo" ASC, "formulario" ASC);

-- CreateIndex
CREATE INDEX "tenant_field_configs_tenantId_idx" ON "public"."tenant_field_configs"("tenantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_field_configs_tenantId_modulo_formulario_key" ON "public"."tenant_field_configs"("tenantId" ASC, "modulo" ASC, "formulario" ASC);

-- AddForeignKey
ALTER TABLE "public"."tenant_field_config_audit_logs" ADD CONSTRAINT "tenant_field_config_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_field_configs" ADD CONSTRAINT "tenant_field_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
