-- CreateTable
CREATE TABLE "direcciones_entrega" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direcciones_entrega_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "direcciones_entrega_tenantId_idx" ON "direcciones_entrega"("tenantId");
ALTER TABLE "direcciones_entrega" ADD CONSTRAINT "direcciones_entrega_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
