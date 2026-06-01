-- AlterTable
ALTER TABLE "viajes" ADD COLUMN     "transportistaEfectivoId" TEXT;

-- CreateIndex
CREATE INDEX "viajes_tenantId_transportistaEfectivoId_idx" ON "viajes"("tenantId", "transportistaEfectivoId");

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_transportistaEfectivoId_fkey" FOREIGN KEY ("transportistaEfectivoId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
