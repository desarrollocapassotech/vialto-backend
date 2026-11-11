import { Prisma } from "@prisma/client";
import { recalcularEstadoImputacionPago } from "../../shared/cuenta-corriente/movimiento-cc.util";
import { fechaCalendarioAr } from "../../shared/util/fecha-ar.util";
import { actualizarEstadoCargoLiquidacionCc } from "./viaje-cuenta-corriente";

/**
 * Pagos al transportista cargados desde Viajes → PAGO en Cuenta corriente (nov 2026).
 *
 * Antes, "Registrar pago transportista" (o la lista de pagos del alta/edición del viaje)
 * solo escribía `Viaje.pagosTransportista`: la liquidación figuraba pagada pero en Cuenta
 * corriente no había ningún PAGO y el saldo del proveedor seguía mostrando la deuda.
 *
 * Ahora cada entrada de `pagosTransportista` cargada desde Viajes tiene su PAGO en Cuenta
 * corriente (proveedor = transportista del viaje, `origen: 'manual'`, `viajeId` = el viaje),
 * vinculado en los dos sentidos: la entrada guarda `ccPagoId` y el movimiento `viajeId`
 * (ningún otro PAGO de Cuenta corriente lleva `viajeId`). Si el viaje tiene una liquidación
 * vigente, el pago se imputa a su compra; si no, queda a cuenta y se imputa solo al crear la
 * liquidación (`imputarPagosDeViajesALiquidacion`).
 *
 * Las entradas con `ccImputacionId` son el camino inverso (un pago cargado en Cuenta
 * corriente e imputado a la liquidación, espejado en el viaje): ya tienen su PAGO y se saltean.
 *
 * Funciones planas sobre un `TransactionClient`, sin DI: las usan ViajesService y el sync de
 * liquidaciones.
 */

type Tx = Prisma.TransactionClient;
type EntradaPago = Record<string, unknown>;

const EPS = 1e-6;

const round2 = (n: number) => Math.round(n * 100) / 100;

function monedaDe(v: unknown): "ARS" | "USD" {
  return v === "USD" ? "USD" : "ARS";
}

/** Entrada cargada desde Viajes (no espejo de una imputación de Cuenta corriente). */
function esPagoDeViaje(p: EntradaPago): boolean {
  return !String(p.ccImputacionId ?? "").trim();
}

function datosPago(p: EntradaPago) {
  const fechaRaw = String(p.fecha ?? "").slice(0, 10);
  return {
    importe: round2(Number(p.monto) || 0),
    moneda: monedaDe(p.moneda),
    fecha: fechaCalendarioAr(fechaRaw || undefined),
    numeroComprobante: String(p.comprobante ?? "").trim() || null,
  };
}

/**
 * A quién va el PAGO: al transportista de la liquidación vigente del viaje (en LSF suele
 * ser el efectivo, el que hace el flete, no el contratante) o, sin liquidación, al efectivo
 * si hay y si no al contratante. Así queda en la misma cuenta que la compra que cancela.
 */
export async function proveedorDePagosDelViaje(
  tx: Tx,
  tenantId: string,
  viaje: { id: string; transportistaId: string | null; transportistaEfectivoId: string | null },
): Promise<string | null> {
  if (!viaje.transportistaId) return null;
  const lv = await tx.liquidacionViaje.findFirst({
    where: { tenantId, viajeId: viaje.id, liquidacion: { estado: { not: "anulado" } } },
    select: { liquidacion: { select: { transportistaId: true } } },
  });
  return lv?.liquidacion.transportistaId ?? viaje.transportistaEfectivoId ?? viaje.transportistaId;
}

/** Compra (cargo de Cuenta corriente) de la liquidación vigente del viaje, si existe. */
async function cargoLiquidacionVigente(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  proveedorId: string,
  moneda: string,
) {
  const lv = await tx.liquidacionViaje.findFirst({
    where: { tenantId, viajeId, liquidacion: { estado: { not: "anulado" } } },
    select: { liquidacionId: true },
  });
  if (!lv) return null;
  return tx.movimientoCuentaCorriente.findFirst({
    where: {
      tenantId,
      liquidacionId: lv.liquidacionId,
      tipo: "cargo",
      proveedorId,
      moneda,
      estadoDisponibilidad: { not: "anulado" },
    },
  });
}

async function sumaImputada(tx: Tx, tenantId: string, campo: "pagoId" | "cargoId", id: string) {
  const agg = await tx.imputacionCuentaCorriente.aggregate({
    where: { tenantId, [campo]: id },
    _sum: { importe: true },
  });
  return agg._sum.importe ?? 0;
}

/**
 * Imputa lo disponible de un PAGO (cargado desde Viajes) a la compra de la liquidación
 * vigente de su viaje, hasta el saldo de la compra. Sin liquidación, no hace nada (queda a
 * cuenta). No toca `Viaje.pagosTransportista`: el pago ya está en el viaje.
 */
async function imputarPagoAViajeLiquidado(
  tx: Tx,
  tenantId: string,
  pago: { id: string; viajeId: string | null; proveedorId: string | null; moneda: string; importe: number },
  userId?: string | null,
): Promise<string | null> {
  if (!pago.viajeId || !pago.proveedorId) return null;
  const cargo = await cargoLiquidacionVigente(tx, tenantId, pago.viajeId, pago.proveedorId, pago.moneda);
  if (!cargo) return null;
  const disponible = round2(pago.importe - (await sumaImputada(tx, tenantId, "pagoId", pago.id)));
  const pendiente = round2(cargo.importe - (await sumaImputada(tx, tenantId, "cargoId", cargo.id)));
  const importe = round2(Math.min(disponible, pendiente));
  if (importe <= EPS) return cargo.liquidacionId;
  const existente = await tx.imputacionCuentaCorriente.findFirst({
    where: { tenantId, pagoId: pago.id, cargoId: cargo.id },
  });
  if (existente) {
    await tx.imputacionCuentaCorriente.update({
      where: { id: existente.id },
      data: { importe: round2(existente.importe + importe) },
    });
  } else {
    await tx.imputacionCuentaCorriente.create({
      data: { tenantId, pagoId: pago.id, cargoId: cargo.id, importe, createdBy: userId ?? null },
    });
  }
  await recalcularEstadoImputacionPago(tx, tenantId, pago.id);
  return cargo.liquidacionId;
}

/** Borra las imputaciones de un PAGO y devuelve las liquidaciones de las compras afectadas. */
async function quitarImputacionesDePago(tx: Tx, tenantId: string, pagoId: string) {
  const imputaciones = await tx.imputacionCuentaCorriente.findMany({
    where: { tenantId, pagoId },
    select: { id: true, cargo: { select: { liquidacionId: true } } },
  });
  if (imputaciones.length === 0) return [];
  await tx.imputacionCuentaCorriente.deleteMany({
    where: { tenantId, id: { in: imputaciones.map((i) => i.id) } },
  });
  return imputaciones
    .map((i) => i.cargo.liquidacionId)
    .filter((id): id is string => !!id);
}

/**
 * Alinea los PAGOS de Cuenta corriente con `Viaje.pagosTransportista` (solo las entradas
 * cargadas desde Viajes): crea los que faltan (y guarda su `ccPagoId` en la entrada),
 * actualiza los que cambiaron, borra los de entradas que ya no están y los imputa a la
 * liquidación vigente. Idempotente. Llamarla después de escribir `pagosTransportista`.
 */
export async function sincronizarPagosCcDelViaje(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  userId?: string | null,
) {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: { id: true, transportistaId: true, transportistaEfectivoId: true, pagosTransportista: true },
  });
  if (!viaje) return;
  const proveedorId = await proveedorDePagosDelViaje(tx, tenantId, viaje);
  const entradas: EntradaPago[] = Array.isArray(viaje.pagosTransportista)
    ? (viaje.pagosTransportista as EntradaPago[]).map((p) => ({ ...p }))
    : [];
  const existentes = await tx.movimientoCuentaCorriente.findMany({
    where: { tenantId, viajeId, tipo: "pago" },
  });
  const porId = new Map(existentes.map((m) => [m.id, m]));
  const usados = new Set<string>();
  const liquidacionesAfectadas = new Set<string>();
  let jsonCambio = false;

  for (const entrada of entradas) {
    if (!esPagoDeViaje(entrada)) continue;
    const datos = datosPago(entrada);
    const ccPagoId = String(entrada.ccPagoId ?? "");
    const actual = ccPagoId ? porId.get(ccPagoId) : undefined;

    if (!proveedorId || datos.importe <= EPS) {
      if (ccPagoId) {
        delete entrada.ccPagoId;
        jsonCambio = true;
      }
      continue;
    }

    if (actual && !usados.has(actual.id)) {
      usados.add(actual.id);
      const cambiaPlata =
        Math.abs(actual.importe - datos.importe) > EPS ||
        actual.moneda !== datos.moneda ||
        actual.proveedorId !== proveedorId;
      const cambiaDato =
        actual.fecha.getTime() !== datos.fecha.getTime() ||
        (actual.numeroComprobante ?? null) !== datos.numeroComprobante;
      if (cambiaPlata) {
        for (const l of await quitarImputacionesDePago(tx, tenantId, actual.id)) {
          liquidacionesAfectadas.add(l);
        }
      }
      if (cambiaPlata || cambiaDato) {
        await tx.movimientoCuentaCorriente.update({
          where: { id: actual.id },
          data: {
            proveedorId,
            contraparteId: proveedorId,
            importe: datos.importe,
            moneda: datos.moneda,
            fecha: datos.fecha,
            // Un número cargado después en Cuenta corriente no se pisa con vacío.
            ...(datos.numeroComprobante ? { numeroComprobante: datos.numeroComprobante } : {}),
          },
        });
      }
      const liq = await imputarPagoAViajeLiquidado(
        tx,
        tenantId,
        { ...actual, proveedorId, importe: datos.importe, moneda: datos.moneda },
        userId,
      );
      if (liq) liquidacionesAfectadas.add(liq);
      await recalcularEstadoImputacionPago(tx, tenantId, actual.id);
      continue;
    }

    const creado = await tx.movimientoCuentaCorriente.create({
      data: {
        tenantId,
        proveedorId,
        contraparteId: proveedorId,
        viajeId,
        tipo: "pago",
        origen: "manual",
        concepto: "PAGO",
        importe: datos.importe,
        moneda: datos.moneda,
        fecha: datos.fecha,
        numeroComprobante: datos.numeroComprobante,
        // Las observaciones del pago (ej. "Transferencia Itau…") van como medio de pago.
        referencia: String(entrada.observaciones ?? "").trim().slice(0, 200) || null,
        createdBy: userId ?? (typeof entrada.createdBy === "string" ? entrada.createdBy : null),
      },
    });
    usados.add(creado.id);
    entrada.ccPagoId = creado.id;
    jsonCambio = true;
    const liq = await imputarPagoAViajeLiquidado(tx, tenantId, creado, userId);
    if (liq) liquidacionesAfectadas.add(liq);
  }

  // PAGOS de entradas que ya no están en el viaje: se borran con sus imputaciones.
  for (const m of existentes) {
    if (usados.has(m.id)) continue;
    for (const l of await quitarImputacionesDePago(tx, tenantId, m.id)) {
      liquidacionesAfectadas.add(l);
    }
    await tx.movimientoCuentaCorriente.deleteMany({ where: { id: m.id, tenantId } });
  }

  if (jsonCambio) {
    await tx.viaje.update({
      where: { id: viajeId },
      data: { pagosTransportista: entradas as unknown as Prisma.InputJsonValue },
    });
  }
  for (const liquidacionId of liquidacionesAfectadas) {
    await actualizarEstadoCargoLiquidacionCc(tx, tenantId, liquidacionId);
  }
}

/**
 * Al crear (o actualizar) la compra de una liquidación: los PAGOS cargados desde Viajes
 * para sus viajes que quedaron a cuenta se imputan a esa compra (y pasan a la cuenta del
 * transportista liquidado, si el PAGO estaba en otra). Idempotente.
 */
export async function imputarPagosDeViajesALiquidacion(
  tx: Tx,
  tenantId: string,
  viajeIds: string[],
) {
  for (const viajeId of new Set(viajeIds)) {
    await sincronizarPagosCcDelViaje(tx, tenantId, viajeId);
  }
}

/**
 * Camino inverso, desde Cuenta corriente: se eliminó el PAGO de un viaje → se saca su
 * entrada de `Viaje.pagosTransportista`. Devuelve true si había algo para sacar.
 */
export async function quitarEntradaPagoDeViaje(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  ccPagoId: string,
) {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: { pagosTransportista: true },
  });
  if (!viaje || !Array.isArray(viaje.pagosTransportista)) return false;
  const pagos = viaje.pagosTransportista as EntradaPago[];
  const quedan = pagos.filter((p) => p.ccPagoId !== ccPagoId);
  if (quedan.length === pagos.length) return false;
  await tx.viaje.update({
    where: { id: viajeId },
    data: { pagosTransportista: quedan as unknown as Prisma.InputJsonValue },
  });
  await recalcularLiquidacionDelViaje(tx, tenantId, viajeId);
  return true;
}

/** Estado de pago de la compra de la liquidación vigente del viaje (desde sus pagos). */
async function recalcularLiquidacionDelViaje(tx: Tx, tenantId: string, viajeId: string) {
  const lv = await tx.liquidacionViaje.findFirst({
    where: { tenantId, viajeId, liquidacion: { estado: { not: "anulado" } } },
    select: { liquidacionId: true },
  });
  if (lv) await actualizarEstadoCargoLiquidacionCc(tx, tenantId, lv.liquidacionId);
}

/**
 * Camino inverso, desde Cuenta corriente: se editó el PAGO de un viaje → la entrada del
 * viaje toma su importe, moneda, fecha y número.
 */
export async function actualizarEntradaPagoDeViaje(
  tx: Tx,
  tenantId: string,
  pago: { id: string; viajeId: string | null; importe: number; moneda: string; fecha: Date; numeroComprobante: string | null },
) {
  if (!pago.viajeId) return;
  const viaje = await tx.viaje.findFirst({
    where: { id: pago.viajeId, tenantId },
    select: { pagosTransportista: true },
  });
  if (!viaje || !Array.isArray(viaje.pagosTransportista)) return;
  let cambio = false;
  const pagos = (viaje.pagosTransportista as EntradaPago[]).map((p) => {
    if (p.ccPagoId !== pago.id) return p;
    cambio = true;
    const out: EntradaPago = {
      ...p,
      monto: pago.importe,
      moneda: monedaDe(pago.moneda),
      fecha: pago.fecha.toISOString().slice(0, 10),
    };
    if (pago.numeroComprobante) out.comprobante = pago.numeroComprobante;
    return out;
  });
  if (!cambio) return;
  await tx.viaje.update({
    where: { id: pago.viajeId },
    data: { pagosTransportista: pagos as unknown as Prisma.InputJsonValue },
  });
  await recalcularLiquidacionDelViaje(tx, tenantId, pago.viajeId);
}
