-- CreateTable
CREATE TABLE "paises" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "esPredefinido" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "paises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paises_tenantId_idx" ON "paises"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "paises_tenantId_nombre_key" ON "paises"("tenantId", "nombre");

-- AddForeignKey
ALTER TABLE "paises" ADD CONSTRAINT "paises_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;
