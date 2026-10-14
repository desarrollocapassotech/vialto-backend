import type { Prisma } from "@prisma/client";
import {
  compensarMovimientoCc,
  moverImputaciones,
} from "../../shared/cuenta-corriente/movimiento-cc.util";
import { fechaCalendarioAr } from "../../shared/util/fecha-ar.util";
import {
  actualizarEstadoCargoLiquidacionCc,
  sincronizarCuentaCorrienteViajesPorIds,
} from "../viajes/viaje-cuenta-corriente";
import { formatNumeroComprobante } from "./arca.util";
import { round2 } from "./arca-iva.util";

/**
 * Cuenta corriente del lado proveedor para una liquidación (funciones planas sobre un
 * `TransactionClient`, las llama `LiquidacionesService` después de cada cambio de estado).
 *
 * VTO-430: al liquidar, el movimiento que nació con el viaje se TRANSFORMA en el de la
 * liquidación (concepto, número, fecha de la liquidación e importe líquido —neto con
 * comisión, IVA y conceptos—; la fecha original queda en `fechaOrigen`). Con varios
 * viajes queda una sola fila: los movimientos de los otros viajes se unifican en ella.
 * VTO-431: al anular (o eliminar el borrador) se compensa con un crédito en el Haber y los viajes
 * vuelven a tener su movimiento de viaje.
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
  createdAt: Date;
  viajes: Array<{ viajeId: string }>;
};

function numeroLiquidacion(liq: Pick<LiquidacionCc, "ptoVenta" | "cbteNro">): string | null {
  return liq.cbteNro ? formatNumeroComprobante(liq.ptoVenta ?? 0, liq.cbteNro) : null;
}

export function conceptoCargoLiquidacion(numero: string | null): string {
  return numero ? `Compra automática por liquidación ${numero}` : "Compra automática por liquidación";
}

export function conceptoAnulacionLiquidacion(numero: string | null): string {
  return numero ? `Anulación liquidación ${numero}` : "Anulación de liquidación";
}

async function cargarLiquidacion(tx: Tx, tenantId: string, liquidacionId: string) {
  return (await tx.liquidacion.findFirst({
    where: { id: liquidacionId, tenantId },
    include: { viajes: { select: { viajeId: true } } },
  })) as LiquidacionCc | null;
}

/**
 * Alinea la cuenta corriente con el estado actual de la liquidación: si está anulada,
 * compensa su movimiento; si no, transforma/unifica los movimientos de sus viajes y
 * actualiza importe, concepto y número. Idempotente.
 */
export async function sincronizarCargoLiquidacionCc(
  tx: Tx,
  tenantId: string,
  liquidacionId: string,
  opts: { ivaTransportistaHabilitado: boolean },
) {
  const liq = await cargarLiquidacion(tx, tenantId, liquidacionId);
  if (!liq) return;
  if (liq.estado === "anulado") {
    await anularCargoLiquidacionCc(tx, tenantId, liq, opts);
    return;
  }

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

  let cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, liquidacionId: liq.id, tipo: "cargo" },
  });
  if (cargo?.estadoDisponibilidad === "anulado") return;

  const viajeIds = liq.viajes.map((v) => v.viajeId);
  const deViajes = viajeIds.length
    ? await tx.movimientoCuentaCorriente.findMany({
        where: {
          tenantId,
          proveedorId: liq.transportistaId,
          viajeId: { in: viajeIds },
          tipo: "cargo",
          origen: "viaje",
          estadoDisponibilidad: { not: "anulado" },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  if (cargo) {
    cargo = await tx.movimientoCuentaCorriente.update({ where: { id: cargo.id }, data: datos });
  } else {
    const fecha = fechaCalendarioAr(liq.createdAt.toISOString());
    if (deViajes.length > 0) {
      const base = deViajes.shift()!;
      cargo = await tx.movimientoCuentaCorriente.update({
        where: { id: base.id },
        data: { ...datos, fecha, fechaOrigen: base.fecha },
      });
    } else {
      cargo = await tx.movimientoCuentaCorriente.create({
        data: { tenantId, ...datos, fecha, viajeId: viajeIds[0] ?? null },
      });
    }
  }

  for (const m of deViajes) {
    await moverImputaciones(tx, tenantId, m.id, cargo.id);
    await tx.movimientoCuentaCorriente.update({
      where: { id: m.id },
      data: { estadoDisponibilidad: "anulado" },
    });
  }
  await actualizarEstadoCargoLiquidacionCc(tx, tenantId, liq.id);
}

/**
 * Compensa el movimiento de la liquidación con un crédito en el Haber (comprobante: la NC/ND de
 * anulación si la hay, si no el número de la liquidación) y regenera el movimiento de
 * viaje del lado proveedor. Para eliminar un borrador, llamarla ANTES de borrar la
 * liquidación con `viajesLiberados: true`, así los viajes ya no la ven vigente.
 */
export async function anularCargoLiquidacionCc(
  tx: Tx,
  tenantId: string,
  liq: LiquidacionCc,
  opts: { ivaTransportistaHabilitado: boolean; regenerarViajes?: boolean },
) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, liquidacionId: liq.id, tipo: "cargo" },
  });
  if (cargo) {
    const numero = numeroLiquidacion(liq);
    const numeroAnulacion = liq.anulacionCbteNro
      ? formatNumeroComprobante(liq.anulacionPtoVenta ?? 0, liq.anulacionCbteNro)
      : null;
    await compensarMovimientoCc(tx, tenantId, cargo, {
      concepto: conceptoAnulacionLiquidacion(numero),
      numeroComprobante: numeroAnulacion ?? numero,
    });
  }
  if (opts.regenerarViajes !== false) {
    await sincronizarCuentaCorrienteViajesPorIds(
      tx,
      tenantId,
      liq.viajes.map((v) => v.viajeId),
      { lados: ["proveedor"], ivaTransportistaHabilitado: opts.ivaTransportistaHabilitado },
    );
  }
}

/** Para eliminar un borrador: compensa ahora; los viajes se regeneran después de borrarla. */
export async function anularCargoLiquidacionAntesDeEliminar(
  tx: Tx,
  tenantId: string,
  liquidacionId: string,
) {
  const liq = await cargarLiquidacion(tx, tenantId, liquidacionId);
  if (!liq) return [];
  await anularCargoLiquidacionCc(tx, tenantId, liq, {
    ivaTransportistaHabilitado: false,
    regenerarViajes: false,
  });
  return liq.viajes.map((v) => v.viajeId);
}
