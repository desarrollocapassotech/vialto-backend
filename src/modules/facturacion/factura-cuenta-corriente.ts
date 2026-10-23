import type { Pago, Prisma } from "@prisma/client";
import {
  compensarMovimientoCc,
  recalcularEstadoImputacionPago,
  totalImputadoCargo,
} from "../../shared/cuenta-corriente/movimiento-cc.util";
import { fechaCalendarioAr } from "../../shared/util/fecha-ar.util";
import { roundMoney2 } from "./factura-estado-lectura";

const EPS = 1e-6;

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

/**
 * Cobro cargado desde Facturas (`createPago` / "Marcar como cobrada"): genera en Cuenta
 * corriente el mismo cobro que si se hubiera registrado allá — un "COBRO" imputado a la
 * venta de la factura, con la imputación apuntando a este `Pago` (`pagoFacturacionId`),
 * así no se vuelve a crear otro `Pago` y "Ver imputación" lo muestra. Lo que el pago
 * supere del saldo de la venta queda a cuenta. Sin venta en CC (o anulada) no hace nada.
 * El estado de la venta lo sigue fijando `actualizarEstadoCargoFactura` desde los `Pago`.
 */
export async function registrarCobroCcDesdeFactura(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pago: Pick<Pago, "id" | "facturaId" | "importe" | "fecha" | "formaPago">,
) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: {
      tenantId,
      facturaId: pago.facturaId,
      tipo: "cargo",
      estadoDisponibilidad: { not: "anulado" },
    },
  });
  if (!cargo) return null;

  const cobro = await tx.movimientoCuentaCorriente.create({
    data: {
      tenantId,
      clienteId: cargo.clienteId,
      proveedorId: cargo.proveedorId,
      contraparteId: cargo.contraparteId,
      tipo: "pago",
      origen: "manual",
      concepto: cargo.clienteId ? "COBRO" : "PAGO",
      importe: pago.importe,
      moneda: cargo.moneda,
      fecha: fechaCalendarioAr(pago.fecha.toISOString()),
      referencia: pago.formaPago?.trim() || null,
    },
  });
  const pendiente = roundMoney2(cargo.importe - (await totalImputadoCargo(tx, tenantId, cargo.id)));
  const importe = roundMoney2(Math.min(pago.importe, pendiente));
  if (importe > EPS) {
    await tx.imputacionCuentaCorriente.create({
      data: {
        tenantId,
        pagoId: cobro.id,
        cargoId: cargo.id,
        importe,
        pagoFacturacionId: pago.id,
      },
    });
  }
  await recalcularEstadoImputacionPago(tx, tenantId, cobro.id);
  return cobro;
}

/**
 * Contraparte de `registrarCobroCcDesdeFactura`, al eliminar un `Pago` desde Facturas:
 * deshace la imputación que lo espeja en Cuenta corriente. Si el cobro queda sin
 * imputaciones y no era mayor que este pago (no le queda nada a cuenta), también se
 * borra; si no, queda a cuenta como cualquier cobro sin imputar.
 */
export async function quitarCobroCcDeFactura(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pago: Pick<Pago, "id" | "importe">,
) {
  const imputaciones = await tx.imputacionCuentaCorriente.findMany({
    where: { tenantId, pagoFacturacionId: pago.id },
  });
  for (const imp of imputaciones) {
    await tx.imputacionCuentaCorriente.delete({ where: { id: imp.id } });
    const cobro = await tx.movimientoCuentaCorriente.findFirst({
      where: { id: imp.pagoId, tenantId },
    });
    if (!cobro) continue;
    const quedan = await tx.imputacionCuentaCorriente.count({
      where: { tenantId, pagoId: cobro.id },
    });
    if (quedan === 0 && cobro.importe <= pago.importe + EPS) {
      await tx.movimientoCuentaCorriente.delete({ where: { id: cobro.id } });
    } else {
      await recalcularEstadoImputacionPago(tx, tenantId, cobro.id);
    }
  }
}
