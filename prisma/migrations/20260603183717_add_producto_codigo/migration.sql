-- CreateTable
CREATE TABLE "producto_secuencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "producto_secuencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "producto_secuencias_tenantId_key" ON "producto_secuencias"("tenantId");
