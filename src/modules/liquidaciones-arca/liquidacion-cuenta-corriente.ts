import type { Prisma } from "@prisma/client";
import { compensarMovimientoCc } from "../../shared/cuenta-corriente/movimiento-cc.util";
import { fechaCalendarioAr } from "../../shared/util/fecha-ar.util";
import { actualizarEstadoCargoLiquidacionCc } from "../viajes/viaje-cuenta-corriente";
import { conceptoAnulacion } from "../facturacion/cargo-factura.util";
import { formatNumeroComprobante } from "./arca.util";
import { round2 } from "./arca-iva.util";

/**
 * Cuenta corriente del lado proveedor para una liquidación (funciones planas sobre un
 * `TransactionClient`, las llama `LiquidacionesService` después de cada cambio de estado).
 *
 * La cuenta corriente depende solo de facturas y liquidaciones: el movimiento de la
 * compra nace al crear la liquidación —también un borrador con ARCA— por el importe
 * líquido (neto con comisión, IVA y conceptos), una fila por liquidación, y se actualiza
 * con sus cambios (importe, número al emitir). VTO-431: al anularla o eliminarla se
 * compensa con un crédito en el Haber.
 */

type Tx = Prisma.TransactionClient;

type LiquidacionCc = {
  id: string;
  tenantId: string;
  transportistaId: string;
  estado: string;
  moneda: string;
  liquido: number;
  ptoVenta: number | null;
  cbteNro: number | null;
  numeroComprobanteProveedor?: string | null;
  anulacionPtoVenta?: number | null;
  anulacionCbteNro?: number | null;
  anulacionCbteTipo?: number | null;
  anulacionMetodo?: string | null;
  createdAt: Date;
  viajes: Array<{ viajeId: string }>;
};

/**
 * Número que muestra la columna Comprobante: el del CVLP si se emitió con ARCA; si no, el
 * de la factura que cargó el proveedor (liquidaciones manuales).
 */
function numeroLiquidacion(
  liq: Pick<LiquidacionCc, "ptoVenta" | "cbteNro" | "numeroComprobanteProveedor">,
): string | null {
  if (liq.cbteNro) return formatNumeroComprobante(liq.ptoVenta ?? 0, liq.cbteNro);
  return liq.numeroComprobanteProveedor?.trim() || null;
}

/**
 * Concepto de la compra que genera una liquidación (sin número: va en la columna
 * Comprobante): "LIQUIDO PRODUCTO" si se emitió el CVLP con ARCA, "LIQUIDACION" si es
 * manual. Mientras espera la anulación manual no cambia (la cuenta corriente no muestra
 * nada hasta que se anula: recién ahí aparece el crédito "ANULACION MANUAL").
 */
export function conceptoCargoLiquidacion(liq: Pick<LiquidacionCc, "cbteNro">): string {
  return liq.cbteNro != null ? "LIQUIDO PRODUCTO" : "LIQUIDACION";
}

/**
 * Concepto del crédito que anula una liquidación: la NC/ND emitida con ARCA (ej. "NOTA DE
 * CRÉDITO A"), "ANULACION MANUAL" con el método manual (comprobante pre-impreso) o
 * "ANULACION" si se eliminó un borrador / sin ARCA. Depende de cómo anula la empresa.
 */
function conceptoAnulacionLiquidacion(
  liq: Pick<LiquidacionCc, "anulacionCbteNro" | "anulacionCbteTipo" | "anulacionMetodo">,
): string {
  // La manual también guarda número (el del pre-impreso), pero no es una NC/ND.
  if (liq.anulacionMetodo === "manual") return "ANULACION MANUAL";
  if (liq.anulacionCbteNro) return conceptoAnulacion(liq.anulacionCbteTipo);
  return conceptoAnulacion();
}

/** `include` para traer el movimiento de la compra junto con la liquidación. */
export const MOVIMIENTO_CC_PAGO_SELECT = {
  where: { tipo: "cargo" },
  select: { estadoDisponibilidad: true },
} as const;

/** pagada | pago_parcial | pendiente — null si no aplica (anulada o sin movimiento). */
export type EstadoPagoLiquidacion = "pagada" | "pago_parcial" | "pendiente" | null;

/**
 * Estado de pago de una liquidación, leído SOLO de su movimiento en Cuenta corriente
 * (Pendiente / Parcial / Cancelado según los pagos imputados): Liquidaciones lo muestra
 * pero no lo cambia. Quita `movimientosCc` de la respuesta.
 */
export function conEstadoPago<T extends { estado: string; movimientosCc: { estadoDisponibilidad: string }[] }>(
  liq: T,
): Omit<T, "movimientosCc"> & { estadoPago: EstadoPagoLiquidacion } {
  const { movimientosCc, ...rest } = liq;
  const cargo = movimientosCc.find((m) => m.estadoDisponibilidad !== "anulado");
  const estadoPago: EstadoPagoLiquidacion =
    liq.estado === "anulado" || !cargo
      ? null
      : cargo.estadoDisponibilidad === "cancelado"
        ? "pagada"
        : cargo.estadoDisponibilidad === "parcial"
          ? "pago_parcial"
          : "pendiente";
  return { ...rest, estadoPago };
}

async function cargarLiquidacion(tx: Tx, tenantId: string, liquidacionId: string) {
  return (await tx.liquidacion.findFirst({
    where: { id: liquidacionId, tenantId },
    include: { viajes: { select: { viajeId: true } } },
  })) as LiquidacionCc | null;
}

/**
 * Alinea la cuenta corriente con el estado actual de la liquidación: la crea o actualiza
 * (importe, concepto y número) y, si está anulada, la compensa. Una liquidación anulada
 * que nunca tuvo movimiento (datos previos a este circuito) recibe el par completo:
 * la compra y su crédito. Idempotente.
 */
export async function sincronizarCargoLiquidacionCc(tx: Tx, tenantId: string, liquidacionId: string) {
  const liq = await cargarLiquidacion(tx, tenantId, liquidacionId);
  if (!liq) return;

  const numero = numeroLiquidacion(liq);
  const datos = {
    proveedorId: liq.transportistaId,
    contraparteId: liq.transportistaId,
    tipo: "cargo",
    origen: "liquidacion",
    liquidacionId: liq.id,
    concepto: conceptoCargoLiquidacion(liq),
    importe: round2(liq.liquido),
    moneda: liq.moneda,
    numeroComprobante: numero,
  };

  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, liquidacionId: liq.id, tipo: "cargo" },
  });
  // Ya compensado: queda como está, para auditoría.
  if (cargo?.estadoDisponibilidad === "anulado") return;
  if (cargo) {
    await tx.movimientoCuentaCorriente.update({ where: { id: cargo.id }, data: datos });
  } else {
    await tx.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        ...datos,
        fecha: fechaCalendarioAr(liq.createdAt.toISOString()),
        viajeId: liq.viajes[0]?.viajeId ?? null,
      },
    });
  }
  if (liq.estado === "anulado") {
    await anularCargoLiquidacionCc(tx, tenantId, liq);
    return;
  }
  await actualizarEstadoCargoLiquidacionCc(tx, tenantId, liq.id);
}

/**
 * Compensa el movimiento de la liquidación con un crédito en el Haber (comprobante: la
 * NC/ND de anulación si la hay, si no el número de la liquidación). Sus pagos imputados
 * quedan a cuenta.
 */
async function anularCargoLiquidacionCc(tx: Tx, tenantId: string, liq: LiquidacionCc) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, liquidacionId: liq.id, tipo: "cargo" },
  });
  if (!cargo) return;
  const numero = numeroLiquidacion(liq);
  const numeroAnulacion = liq.anulacionCbteNro
    ? formatNumeroComprobante(liq.anulacionPtoVenta ?? 0, liq.anulacionCbteNro)
    : null;
  await compensarMovimientoCc(tx, tenantId, cargo, {
    concepto: conceptoAnulacionLiquidacion(liq),
    numeroComprobante: numeroAnulacion ?? numero,
  });
}

/** Eliminar una liquidación (borrador): compensa su movimiento antes de borrarla. */
export async function anularCargoLiquidacionAntesDeEliminar(
  tx: Tx,
  tenantId: string,
  liquidacionId: string,
) {
  const liq = await cargarLiquidacion(tx, tenantId, liquidacionId);
  if (liq) await anularCargoLiquidacionCc(tx, tenantId, liq);
}
