-- Cuenta corriente: transformación del movimiento del viaje al facturar/liquidar (VTO-430)
-- y anulación con movimiento negativo que compensa (VTO-431).

-- Un viaje puede tener más de un movimiento a lo largo del tiempo (original anulado +
-- negativo + movimiento nuevo tras anular la factura), así que deja de ser único por
-- viaje/contraparte. Ya existe el índice común (tenantId, viajeId).
DROP INDEX "movimientos_cuenta_corriente_tenantId_viajeId_contraparteId_key";

ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN "anulaMovimientoId" TEXT,
ADD COLUMN "fechaOrigen" TIMESTAMP(3),
ADD COLUMN "liquidacionId" TEXT;

CREATE UNIQUE INDEX "movimientos_cuenta_corriente_anulaMovimientoId_key" ON "movimientos_cuenta_corriente"("anulaMovimientoId");

CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_liquidacionId_key" ON "movimientos_cuenta_corriente"("tenantId", "liquidacionId");

ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_anulaMovimientoId_fkey" FOREIGN KEY ("anulaMovimientoId") REFERENCES "movimientos_cuenta_corriente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
