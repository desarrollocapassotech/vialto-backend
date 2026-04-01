-- Viajes: nuevos estados + monto + fecha de finalización
UPDATE "viajes"
SET "estado" = 'en_curso'
WHERE "estado" IN ('en_transito', 'despachado');

UPDATE "viajes"
SET "estado" = 'finalizado'
WHERE "estado" = 'cerrado';

ALTER TABLE "viajes"
ADD COLUMN "monto" DOUBLE PRECISION,
ADD COLUMN "fechaFinalizado" TIMESTAMP(3);

UPDATE "viajes"
SET "monto" = "precioCliente"
WHERE "monto" IS NULL
  AND "precioCliente" IS NOT NULL;

UPDATE "viajes"
SET "fechaFinalizado" = COALESCE("fechaLlegada", "createdAt")
WHERE "estado" = 'finalizado'
  AND "fechaFinalizado" IS NULL;

-- Cuenta corriente: origen de movimientos, vínculo a viaje y eliminación de saldo persistido
UPDATE "movimientos_cuenta_corriente"
SET "tipo" = 'pago'
WHERE "tipo" = 'nota_credito';

ALTER TABLE "movimientos_cuenta_corriente"
ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN "viajeId" TEXT;

ALTER TABLE "movimientos_cuenta_corriente"
DROP COLUMN "saldoPost";

ALTER TABLE "movimientos_cuenta_corriente"
ADD CONSTRAINT "movimientos_cuenta_corriente_viajeId_fkey"
FOREIGN KEY ("viajeId") REFERENCES "viajes"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "movimientos_cuenta_corriente_tenantId_fecha_idx"
ON "movimientos_cuenta_corriente"("tenantId", "fecha");

CREATE INDEX "movimientos_cuenta_corriente_tenantId_origen_idx"
ON "movimientos_cuenta_corriente"("tenantId", "origen");

CREATE INDEX "movimientos_cuenta_corriente_tenantId_viajeId_idx"
ON "movimientos_cuenta_corriente"("tenantId", "viajeId");

CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_viajeId_key"
ON "movimientos_cuenta_corriente"("tenantId", "viajeId");
