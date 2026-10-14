import type { Prisma } from "@prisma/client";
import { compensarMovimientoCc } from "../../shared/cuenta-corriente/movimiento-cc.util";
import { sincronizarCuentaCorrienteViajesPorIds } from "../viajes/viaje-cuenta-corriente";

/**
 * VTO-431, lado cliente: al anular (ARCA, nota de crédito) o eliminar (anulación
 * interna, sin ARCA) una factura, su movimiento de cuenta corriente se compensa con un
 * crédito en el Haber y sus cobros imputados quedan a cuenta. Los viajes que estaban en la factura
 * vuelven a figurar sin facturar con un movimiento nuevo de viaje (fecha de hoy).
 *
 * Función plana (sin DI) porque la usan `FacturacionService.removeFactura` y
 * `LiquidacionesService.anularFacturaArca`. Llamarla con los viajes ya desvinculados o
 * con la factura ya marcada `arcaEstado: 'anulado'`, para que el sync del viaje no la
 * vea vigente.
 */
export async function anularCargoFacturaCc(
  tx: Prisma.TransactionClient,
  tenantId: string,
  facturaId: string,
  datos: { concepto: string; numeroComprobante?: string | null },
  viajeIds: string[],
) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, facturaId, tipo: "cargo" },
  });
  if (cargo) {
    await compensarMovimientoCc(tx, tenantId, cargo, datos);
  }
  if (viajeIds.length > 0) {
    await sincronizarCuentaCorrienteViajesPorIds(tx, tenantId, viajeIds, { lados: ["cliente"] });
  }
}
