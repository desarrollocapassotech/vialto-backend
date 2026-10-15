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
  anulacionPtoVenta?: number | null;
  anulacionCbteNro?: number | null;
  anulacionCbteTipo?: number | null;
  createdAt: Date;
  viajes: Array<{ viajeId: string }>;
};

function numeroLiquidacion(liq: Pick<LiquidacionCc, "ptoVenta" | "cbteNro">): string | null {
  return liq.cbteNro ? formatNumeroComprobante(liq.ptoVenta ?? 0, liq.cbteNro) : null;
}

export function conceptoCargoLiquidacion(numero: string | null): string {
  return numero ? `Compra automática por liquidación ${numero}` : "Compra automática por liquidación";
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
    concepto: conceptoCargoLiquidacion(numero),
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
    concepto: conceptoAnulacion(liq.anulacionCbteNro ? liq.anulacionCbteTipo : null),
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
