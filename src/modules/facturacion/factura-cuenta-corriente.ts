import type { Prisma } from "@prisma/client";
import { compensarMovimientoCc } from "../../shared/cuenta-corriente/movimiento-cc.util";

/**
 * VTO-431, lado cliente: al anular (ARCA, nota de crédito) o eliminar (borrador, o
 * anulación interna sin ARCA) una factura, su movimiento de cuenta corriente se compensa
 * con un crédito en el Haber y sus cobros imputados quedan a cuenta. Los viajes no
 * generan movimientos propios: la cuenta corriente depende solo de facturas y
 * liquidaciones.
 *
 * Función plana (sin DI) porque la usan `FacturacionService` y
 * `LiquidacionesService.anularFacturaArca`.
 */
export async function anularCargoFacturaCc(
  tx: Prisma.TransactionClient,
  tenantId: string,
  facturaId: string,
  datos: { concepto: string; numeroComprobante?: string | null },
) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, facturaId, tipo: "cargo" },
  });
  if (cargo) {
    await compensarMovimientoCc(tx, tenantId, cargo, datos);
  }
}
