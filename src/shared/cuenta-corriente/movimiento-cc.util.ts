import type { MovimientoCuentaCorriente, Prisma } from "@prisma/client";
import { fechaCalendarioAr } from "../util/fecha-ar.util";

/**
 * Operaciones de cuenta corriente compartidas por Viajes, Facturación y Liquidaciones
 * (funciones planas sobre un `TransactionClient`, sin depender de ningún módulo).
 *
 * VTO-431 — anulación con un CRÉDITO en el Haber (como una nota de crédito): el
 * movimiento original nunca se borra ni se edita (solo queda marcado `anulado`, que lo
 * saca de saldos, tablero e imputación) y se agrega uno nuevo `tipo: 'credito'` por el
 * mismo importe, vinculado al original por `anulaMovimientoId` (único: no se puede anular
 * dos veces) — queda aplicado a ese original. Un crédito NO es un cobro/pago: no se
 * ofrece para imputar, no cuenta como cobranza ni genera `Pago` en Facturación. También
 * queda `anulado`, así que los saldos —que excluyen lo anulado— no cambian; el historial
 * (saldo acumulado) cuenta el par completo con `cuentaEnHistorialCc`/`signoHistorialCc`.
 */

const EPS = 1e-6;

type Tx = Prisma.TransactionClient;

/** Hoy en Argentina, a medianoche UTC (convención de fechas sin hora). */
export function hoyCc(): Date {
  return fechaCalendarioAr();
}

export function estadoDisponibilidadPorMonto(pagado: number, importe: number): string {
  if (pagado <= EPS) return "pendiente";
  if (pagado + EPS >= importe) return "cancelado";
  return "parcial";
}

function estadoImputacionPorMonto(imputado: number, importe: number): string {
  if (imputado <= EPS) return "no_imputado";
  if (imputado + EPS >= importe) return "imputado";
  return "imputado_parcial";
}

/**
 * ¿El movimiento suma en el saldo acumulado del historial? Todo suma salvo un cargo
 * anulado SIN compensación (anulaciones previas a VTO-431, o unificados en una factura
 * o liquidación): un cargo anulado con su crédito suma igual, porque el par se cancela.
 */
export function cuentaEnHistorialCc(m: {
  tipo: string;
  estadoDisponibilidad: string;
  anulaMovimientoId?: string | null;
  compensado?: boolean;
}): boolean {
  if (m.tipo !== "cargo" || m.estadoDisponibilidad !== "anulado") return true;
  return !!m.anulaMovimientoId || !!m.compensado;
}

/** Signo en el saldo: un cargo (Debe) suma; un cobro/pago o un crédito (Haber) resta. */
export function signoHistorialCc(tipo: string): 1 | -1 {
  return tipo === "cargo" ? 1 : -1;
}

export async function recalcularEstadoImputacionPago(tx: Tx, tenantId: string, pagoId: string) {
  const pago = await tx.movimientoCuentaCorriente.findFirst({ where: { id: pagoId, tenantId } });
  if (!pago) return;
  const suma = await tx.imputacionCuentaCorriente.aggregate({
    where: { tenantId, pagoId },
    _sum: { importe: true },
  });
  await tx.movimientoCuentaCorriente.update({
    where: { id: pagoId },
    data: { estadoImputacion: estadoImputacionPorMonto(suma._sum.importe ?? 0, pago.importe) },
  });
}

/** Saca del JSON `Viaje.pagosTransportista` el espejo de una imputación de Cuenta Corriente. */
async function quitarEspejoPagoTransportista(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  imputacionIds: Set<string>,
) {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: { pagosTransportista: true },
  });
  if (!viaje || !Array.isArray(viaje.pagosTransportista)) return;
  const pagos = viaje.pagosTransportista as Array<Record<string, unknown>>;
  const quedan = pagos.filter((p) => !imputacionIds.has(String(p.ccImputacionId ?? "")));
  if (quedan.length === pagos.length) return;
  await tx.viaje.update({
    where: { id: viajeId },
    data: { pagosTransportista: quedan as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Deshace todas las imputaciones de un cargo: los cobros/pagos vuelven a quedar
 * disponibles ("a cuenta"). También saca sus espejos: el `Pago` de Facturación y la
 * entrada de `Viaje.pagosTransportista`.
 */
export async function liberarImputacionesDeCargo(
  tx: Tx,
  tenantId: string,
  cargo: Pick<MovimientoCuentaCorriente, "id" | "proveedorId" | "viajeId">,
) {
  const imputaciones = await tx.imputacionCuentaCorriente.findMany({
    where: { tenantId, cargoId: cargo.id },
  });
  if (imputaciones.length === 0) return 0;

  const pagosFacturacion = imputaciones
    .map((i) => i.pagoFacturacionId)
    .filter((id): id is string => !!id);
  if (pagosFacturacion.length > 0) {
    await tx.pago.deleteMany({ where: { tenantId, id: { in: pagosFacturacion } } });
  }
  if (cargo.proveedorId && cargo.viajeId) {
    await quitarEspejoPagoTransportista(
      tx,
      tenantId,
      cargo.viajeId,
      new Set(imputaciones.map((i) => i.id)),
    );
  }
  await tx.imputacionCuentaCorriente.deleteMany({
    where: { tenantId, id: { in: imputaciones.map((i) => i.id) } },
  });
  for (const pagoId of new Set(imputaciones.map((i) => i.pagoId))) {
    await recalcularEstadoImputacionPago(tx, tenantId, pagoId);
  }
  return imputaciones.length;
}

/**
 * Pasa las imputaciones de un cargo a otro (al unificar varios movimientos de viaje en
 * el de una factura/liquidación). Si el mismo cobro ya estaba imputado al destino, se
 * suman en una sola imputación.
 */
export async function moverImputaciones(
  tx: Tx,
  tenantId: string,
  desdeCargoId: string,
  haciaCargoId: string,
) {
  const imputaciones = await tx.imputacionCuentaCorriente.findMany({
    where: { tenantId, cargoId: desdeCargoId },
  });
  for (const imp of imputaciones) {
    const enDestino = await tx.imputacionCuentaCorriente.findFirst({
      where: { tenantId, cargoId: haciaCargoId, pagoId: imp.pagoId },
    });
    if (enDestino) {
      await tx.imputacionCuentaCorriente.update({
        where: { id: enDestino.id },
        data: { importe: enDestino.importe + imp.importe },
      });
      await tx.imputacionCuentaCorriente.delete({ where: { id: imp.id } });
    } else {
      await tx.imputacionCuentaCorriente.update({
        where: { id: imp.id },
        data: { cargoId: haciaCargoId },
      });
    }
  }
  return imputaciones.length;
}

/** Suma imputada a un cargo. */
export async function totalImputadoCargo(tx: Tx, tenantId: string, cargoId: string) {
  const suma = await tx.imputacionCuentaCorriente.aggregate({
    where: { tenantId, cargoId },
    _sum: { importe: true },
  });
  return suma._sum.importe ?? 0;
}

/**
 * VTO-431: compensa un cargo con un crédito en el Haber por el mismo importe. El original
 * queda intacto (solo pasa a `anulado`) y sus cobros/pagos imputados quedan a cuenta.
 * Idempotente: un cargo ya anulado no se vuelve a compensar. Devuelve el crédito creado.
 */
export async function compensarMovimientoCc(
  tx: Tx,
  tenantId: string,
  original: MovimientoCuentaCorriente,
  datos: { concepto: string; numeroComprobante?: string | null; fecha?: Date },
) {
  if (original.tipo !== "cargo" || original.estadoDisponibilidad === "anulado") return null;
  const yaCompensado = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, anulaMovimientoId: original.id },
  });
  if (yaCompensado) return null;

  await liberarImputacionesDeCargo(tx, tenantId, original);
  const credito = await tx.movimientoCuentaCorriente.create({
    data: {
      tenantId,
      clienteId: original.clienteId,
      proveedorId: original.proveedorId,
      contraparteId: original.contraparteId,
      viajeId: original.viajeId,
      tipo: "credito",
      origen: "anulacion",
      concepto: datos.concepto,
      importe: original.importe,
      moneda: original.moneda,
      fecha: datos.fecha ?? hoyCc(),
      numeroComprobante: datos.numeroComprobante ?? original.numeroComprobante,
      referencia: original.referencia,
      // Ya aplicado al original: fuera de saldos, tablero e imputación.
      estadoDisponibilidad: "anulado",
      estadoImputacion: "imputado",
      anulaMovimientoId: original.id,
    },
  });
  await tx.movimientoCuentaCorriente.update({
    where: { id: original.id },
    data: { estadoDisponibilidad: "anulado" },
  });
  return credito;
}
