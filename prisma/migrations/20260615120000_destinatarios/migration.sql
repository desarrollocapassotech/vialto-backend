-- CreateTable
CREATE TABLE "destinatarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destinatarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "destinatarios_tenantId_idx" ON "destinatarios"("tenantId");

-- AddForeignKey
ALTER TABLE "destinatarios" ADD CONSTRAINT "destinatarios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
