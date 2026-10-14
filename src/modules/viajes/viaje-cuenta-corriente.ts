import { Prisma } from "@prisma/client";
import { ymdAr } from "../../shared/util/fecha-ar.util";
import {
  compensarMovimientoCc,
  estadoDisponibilidadPorMonto,
  totalImputadoCargo,
} from "../../shared/cuenta-corriente/movimiento-cc.util";
import { engrosarConIva } from "./viaje-ganancia-bruta.util";
import { numeroVisibleViaje } from "./viaje-numero-visible.util";

/**
 * Cuenta corriente generada desde un viaje. Funciones planas sobre un `TransactionClient`,
 * mismo patrón que `viaje-estado-financiero.ts`, para que las usen `ViajesService`,
 * el import de Excel, Facturación y Liquidaciones sin que un módulo dependa del otro.
 *
 * Reglas (VTO-426 / VTO-430 / VTO-431):
 * - El movimiento nace al CREAR el viaje, en todas las empresas (con o sin Facturación).
 *   Cliente: venta por `monto` + otros gastos en la misma moneda. Proveedor: compra por
 *   el acordado con el transportista (`calcularAcordadoTransportista`). Solo si es > 0.
 * - Fecha = día de creación del viaje; concepto "NUEVO VIAJE X" (en pantalla, estado
 *   "Sin facturar" / "Sin liquidar" mientras siga siendo movimiento de viaje). Si el
 *   viaje ya tuvo movimientos (ej. se anuló su factura y vuelve a estar sin facturar),
 *   el nuevo lleva fecha de hoy. Fecha y concepto no se reescriben después.
 * - Mientras no tenga imputaciones, sigue al viaje (importe/moneda/estado).
 * - Con factura vigente (lado cliente) o liquidación vigente (lado proveedor), el
 *   movimiento ya se transformó en el del comprobante: este sync no toca ese lado.
 * - Viaje cancelado, importe en 0 o cambio de cliente/transportista: el movimiento que
 *   ya no corresponde se compensa con un crédito en el Haber (`compensarMovimientoCc`); sus cobros
 *   imputados quedan a cuenta. Si después vuelve a corresponder, se crea uno nuevo.
 * - Finalizar el viaje no crea ni duplica nada.
 */

const EPS = 1e-6;

export type ViajeParaCuentaCorriente = {
  id: string;
  tenantId: string;
  clienteId: string;
  transportistaId: string | null;
  numero: string;
  numeroIdentificacionPersonalizado?: string | null;
  etapa: string;
  createdAt: Date;
  monto: number | null;
  monedaMonto?: string | null;
  otrosGastos?: unknown;
  precioTransportistaExterno?: number | null;
  monedaPrecioTransportistaExterno?: string | null;
  precioTransportistaIvaIncluidoPct?: number | null;
  pagosTransportista?: unknown;
  facturaId?: string | null;
  /** Debe traer `arcaEstado` (lo incluyen `VIAJE_CC_INCLUDE` y `VIAJE_INCLUDE_FULL`). */
  factura?: { id?: string; arcaEstado?: string | null } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  liquidacionesViaje?: any[];
};

/** Include mínimo: factura (para saber si está vigente) y liquidaciones (acordado y vigencia). */
export const VIAJE_CC_INCLUDE = {
  factura: { select: { id: true, arcaEstado: true } },
  liquidacionesViaje: {
    include: {
      liquidacion: { include: { conceptosLineas: true, viajes: true } },
    },
  },
} satisfies Prisma.ViajeInclude;

/** El viaje tiene una factura que no está anulada: su lado cliente lo maneja la factura. */
export function viajeTieneFacturaVigente(viaje: ViajeParaCuentaCorriente): boolean {
  if (!viaje.facturaId) return false;
  return viaje.factura?.arcaEstado !== "anulado";
}

/** El viaje tiene una liquidación no anulada para ese transportista: su lado proveedor lo maneja la liquidación. */
export function viajeTieneLiquidacionVigente(
  viaje: ViajeParaCuentaCorriente,
  transportistaId: string | null,
): boolean {
  if (!transportistaId) return false;
  return (viaje.liquidacionesViaje ?? []).some(
    (lv) =>
      lv.liquidacion &&
      lv.liquidacion.estado !== "anulado" &&
      lv.liquidacion.transportistaId === transportistaId,
  );
}

/**
 * Si el tenant tiene Facturación (manual o ARCA). Mismo OR que el resto del proyecto.
 */
export async function tenantTieneFacturacion(
  client: Pick<Prisma.TransactionClient, "tenant">,
  tenantId: string,
): Promise<boolean> {
  const tenant = await client.tenant.findUnique({
    where: { clerkOrgId: tenantId },
    select: { modules: true },
  });
  const modules = (tenant?.modules ?? []).map((m) => m.toLowerCase());
  return modules.includes("facturacion") || modules.includes("emision-facturas-arca");
}

export function estadoDisponibilidadCcDesde(pagado: number, importe: number): string {
  return estadoDisponibilidadPorMonto(pagado, importe);
}

function monedaNormalizada(m: string | null | undefined): "ARS" | "USD" {
  return m === "USD" ? "USD" : "ARS";
}

/** Venta al cliente: `monto` + otros gastos en la misma moneda. 0 si el viaje no tiene monto. */
export function montoCargoCliente(viaje: {
  monto: number | null;
  monedaMonto?: string | null;
  otrosGastos?: unknown;
}): number {
  const monto = viaje.monto;
  if (monto == null || monto <= 0) return 0;
  const moneda = monedaNormalizada(viaje.monedaMonto);
  const gastos = Array.isArray(viaje.otrosGastos)
    ? (viaje.otrosGastos as Array<{ monto?: number; moneda?: string }>)
    : [];
  const extra = gastos
    .filter((g) => monedaNormalizada(g.moneda) === moneda)
    .reduce((acc, g) => acc + (typeof g.monto === "number" ? g.monto : 0), 0);
  return monto + extra;
}

/**
 * Monto acordado con el transportista: el precio cargado (neto) más el % de IVA que
 * se le suma en efectivo; si hay Liquidación vigente, se reconstruye desde sus montos
 * reales, prorrateando los conceptos según sean del viaje o generales.
 */
export function calcularAcordadoTransportista(
  v: {
    id?: string;
    precioTransportistaExterno?: number | null;
    precioTransportistaIvaIncluidoPct?: number | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    liquidacionesViaje?: any[];
  },
  ivaTransportistaHabilitado: boolean,
): number {
  // Caso base (sin Liquidación vigente): "acordado" es lo que hay que pagarle en
  // efectivo al transportista — el precio cargado (siempre neto) más el % de IVA
  // que se le suma encima, si tiene. Si el tenant tiene el campo deshabilitado
  // (ver ViajesService.ivaTransportistaHabilitado()), el % guardado se ignora sin borrarlo.
  let acordado = engrosarConIva(
    v.precioTransportistaExterno ?? 0,
    ivaTransportistaHabilitado ? Number(v.precioTransportistaIvaIncluidoPct) || 0 : 0,
  );

  if (v.liquidacionesViaje && v.liquidacionesViaje.length > 0) {
    let montoReal = 0;
    let tieneMontoReal = false;

    for (const lv of v.liquidacionesViaje) {
      const liq = lv.liquidacion;
      // Ignoramos anuladas o fallidas
      if (liq && (liq.estado === "anulado" || liq.estado === "error")) continue;

      // Cálculo contemplando conceptos asignados al viaje o generales divididos
      if (liq && Array.isArray(liq.conceptosLineas) && v.id) {
        // El precio del viaje ya es neto (ver comentario de engrosarConIva) — la
        // Liquidación lo usa tal cual, sin ajustar por el % de IVA del viaje. Ese
        // % es independiente del IVA que declara la Liquidación (config aparte).
        const brutoViaje =
          typeof lv.subtotal === "number"
            ? lv.subtotal
            : Number(v.precioTransportistaExterno) || 0;
        const comisionPct = Number(liq.comisionPct) || 0;
        const comisionMonto = (brutoViaje * comisionPct) / 100;

        const divisor =
          typeof liq.cantViajes === "number" && liq.cantViajes > 0
            ? liq.cantViajes
            : Array.isArray(liq.viajes) && liq.viajes.length > 0
              ? liq.viajes.length
              : 1;

        const efectoConceptos = liq.conceptosLineas.reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, c: any) => {
            const monto = Number(c.monto) || 0;
            if (!monto) return sum;
            const conSigno = c.signo === "contra" ? -monto : monto;

            // 1. Asignado específicamente a ESTE viaje (100%)
            if (c.viajeId && String(c.viajeId) === String(v.id)) {
              return sum + conSigno;
            }
            // 2. Asignado a OTRO viaje (0%)
            if (c.viajeId != null && String(c.viajeId).trim() !== "") {
              return sum;
            }
            // 3. General (viajeId == null/empty) -> se divide en el total de viajes
            return sum + conSigno / divisor;
          },
          0,
        );

        const netoGravado = brutoViaje - comisionMonto + efectoConceptos;
        const ivaPct = Number(liq.ivaPct) || 0;
        const ivaMonto = (netoGravado * ivaPct) / 100;

        montoReal += netoGravado + ivaMonto;
        tieneMontoReal = true;
      } else if (lv.subtotal != null) {
        montoReal += Number(lv.subtotal);
        tieneMontoReal = true;
      } else if (liq?.liquido != null) {
        montoReal += Number(liq.liquido);
        tieneMontoReal = true;
      }
    }

    if (tieneMontoReal) {
      acordado = montoReal;
    }
  }

  return acordado;
}

/** Día de creación del viaje en Argentina, guardado a medianoche UTC (convención de fechas sin hora). */
function fechaCreacionViaje(createdAt: Date): Date {
  return new Date(`${ymdAr(createdAt)}T00:00:00.000Z`);
}

/**
 * "NUEVO VIAJE 2026-000012", o con ID propio, con la etiqueta que le da la empresa:
 * "NUEVO VIAJE CTG: 10128901406" (`Tenant.labelIdentificacionPersonalizadaViajes`,
 * "ID propio" si no tiene; mismo fallback que los PDFs).
 */
export async function conceptoNuevoViaje(
  tx: Pick<Prisma.TransactionClient, "tenant">,
  viaje: Pick<ViajeParaCuentaCorriente, "tenantId" | "numero" | "numeroIdentificacionPersonalizado">,
): Promise<string> {
  const idPropio = viaje.numeroIdentificacionPersonalizado?.trim();
  if (!idPropio) return `NUEVO VIAJE ${viaje.numero}`;
  const tenant = await tx.tenant.findUnique({
    where: { clerkOrgId: viaje.tenantId },
    select: { labelIdentificacionPersonalizadaViajes: true },
  });
  const label = tenant?.labelIdentificacionPersonalizadaViajes?.trim() || "ID propio";
  return `NUEVO VIAJE ${label}: ${idPropio}`;
}

export type LadoCc = "cliente" | "proveedor";

export type OpcionesCcViaje = {
  /** Solo hace falta para el lado proveedor (acordado con IVA del transportista). */
  ivaTransportistaHabilitado?: boolean;
  /** Lados a sincronizar; por defecto ambos. */
  lados?: LadoCc[];
};

/**
 * Deja en la cuenta corriente de un lado (cliente o proveedor) a lo sumo un movimiento
 * de viaje vigente: el de `contraparteId` por `importe`. Cualquier otro movimiento de
 * viaje vigente en ese lado (otra contraparte, importe 0, viaje cancelado) se compensa.
 */
async function sincronizarLado(
  tx: Prisma.TransactionClient,
  viaje: ViajeParaCuentaCorriente,
  lado: LadoCc,
  objetivo: {
    contraparteId: string | null;
    importe: number;
    moneda: "ARS" | "USD";
    estadoDisponibilidad: string;
  },
) {
  const filtroLado =
    lado === "cliente" ? { clienteId: { not: null } } : { proveedorId: { not: null } };
  const vigentes = await tx.movimientoCuentaCorriente.findMany({
    where: {
      tenantId: viaje.tenantId,
      viajeId: viaje.id,
      tipo: "cargo",
      origen: "viaje",
      estadoDisponibilidad: { not: "anulado" },
      ...filtroLado,
    },
  });

  const numeroVisible = numeroVisibleViaje(viaje);
  const cancelado = viaje.etapa === "cancelado";
  const corresponde = !cancelado && objetivo.importe > EPS && !!objetivo.contraparteId;
  const actual = corresponde
    ? vigentes.find((m) => m.contraparteId === objetivo.contraparteId)
    : undefined;

  for (const m of vigentes) {
    if (m === actual) continue;
    const motivo = cancelado
      ? "cancelación del viaje"
      : m.contraparteId !== objetivo.contraparteId
        ? `cambio de ${lado === "cliente" ? "cliente" : "transportista"} del viaje`
        : "viaje sin importe";
    await compensarMovimientoCc(tx, viaje.tenantId, m, {
      concepto: `Anulación por ${motivo} ${numeroVisible}`,
    });
  }

  if (!corresponde) return;

  if (actual) {
    if ((await totalImputadoCargo(tx, viaje.tenantId, actual.id)) > 0) return;
    // Fecha, concepto y referencia quedan como se crearon: solo se sigue el importe.
    await tx.movimientoCuentaCorriente.update({
      where: { id: actual.id },
      data: {
        importe: objetivo.importe,
        moneda: objetivo.moneda,
        estadoDisponibilidad: objetivo.estadoDisponibilidad,
      },
    });
    return;
  }

  // Primer movimiento del viaje con esta contraparte: fecha de creación del viaje. Si ya
  // tuvo otros (anulados, o transformados en una factura/liquidación después anulada),
  // el nuevo es de hoy.
  const contraparteId = objetivo.contraparteId!;
  const concepto = await conceptoNuevoViaje(tx, viaje);
  const yaTuvo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId: viaje.tenantId, viajeId: viaje.id, contraparteId, tipo: "cargo" },
    select: { id: true },
  });
  await tx.movimientoCuentaCorriente.create({
    data: {
      tenantId: viaje.tenantId,
      ...(lado === "cliente" ? { clienteId: contraparteId } : { proveedorId: contraparteId }),
      contraparteId,
      viajeId: viaje.id,
      tipo: "cargo",
      origen: "viaje",
      concepto,
      importe: objetivo.importe,
      moneda: objetivo.moneda,
      fecha: yaTuvo ? new Date(`${ymdAr()}T00:00:00.000Z`) : fechaCreacionViaje(viaje.createdAt),
      referencia: numeroVisible,
      estadoDisponibilidad: objetivo.estadoDisponibilidad,
    },
  });
}

/**
 * Crea, actualiza o compensa los movimientos de cuenta corriente del viaje según su
 * estado actual. Idempotente: llamarlo después de cada alta/edición del viaje, al
 * agregar un gasto, o al anular/eliminar su factura o liquidación, deja la cuenta
 * alineada con el viaje.
 */
export async function sincronizarCuentaCorrienteViaje(
  tx: Prisma.TransactionClient,
  viaje: ViajeParaCuentaCorriente,
  opts: OpcionesCcViaje = {},
) {
  const lados = opts.lados ?? ["cliente", "proveedor"];

  if (lados.includes("cliente") && !viajeTieneFacturaVigente(viaje)) {
    await sincronizarLado(tx, viaje, "cliente", {
      contraparteId: viaje.clienteId,
      importe: montoCargoCliente(viaje),
      moneda: monedaNormalizada(viaje.monedaMonto),
      estadoDisponibilidad: "pendiente",
    });
  }

  if (
    lados.includes("proveedor") &&
    !viajeTieneLiquidacionVigente(viaje, viaje.transportistaId)
  ) {
    const moneda = monedaNormalizada(viaje.monedaPrecioTransportistaExterno);
    const acordado =
      !viaje.transportistaId || !viaje.precioTransportistaExterno
        ? 0
        : calcularAcordadoTransportista(viaje, opts.ivaTransportistaHabilitado ?? false);
    const pagos = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
      : [];
    const pagado = pagos
      .filter((p) => monedaNormalizada(p.moneda) === moneda)
      .reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
    await sincronizarLado(tx, viaje, "proveedor", {
      contraparteId: viaje.transportistaId,
      importe: acordado,
      moneda,
      estadoDisponibilidad: estadoDisponibilidadCcDesde(pagado, acordado),
    });
  }
}

/** Variante que carga el viaje por id (para quien no lo tiene ya con factura y liquidaciones). */
export async function sincronizarCuentaCorrienteViajePorId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  viajeId: string,
  opts: OpcionesCcViaje = {},
) {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    include: VIAJE_CC_INCLUDE,
  });
  if (!viaje) return;
  await sincronizarCuentaCorrienteViaje(tx, viaje, opts);
}

/**
 * Estado de pago del movimiento de una liquidación (puede abarcar varios viajes): lo
 * pagado es la suma de `pagosTransportista` de todos sus viajes en la moneda del
 * movimiento — incluye los pagos cargados desde Viajes y los espejos de imputaciones
 * de Cuenta Corriente.
 */
export async function actualizarEstadoCargoLiquidacionCc(
  tx: Prisma.TransactionClient,
  tenantId: string,
  liquidacionId: string,
) {
  const cargo = await tx.movimientoCuentaCorriente.findFirst({
    where: { tenantId, liquidacionId, tipo: "cargo", estadoDisponibilidad: { not: "anulado" } },
  });
  if (!cargo) return;
  const viajes = await tx.liquidacionViaje.findMany({
    where: { tenantId, liquidacionId },
    select: { viaje: { select: { pagosTransportista: true } } },
  });
  const pagado = viajes.reduce((acc, lv) => {
    const pagos = Array.isArray(lv.viaje.pagosTransportista)
      ? (lv.viaje.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
      : [];
    return (
      acc +
      pagos
        .filter((p) => monedaNormalizada(p.moneda) === monedaNormalizada(cargo.moneda))
        .reduce((s, p) => s + (Number(p.monto) || 0), 0)
    );
  }, 0);
  await tx.movimientoCuentaCorriente.update({
    where: { id: cargo.id },
    data: { estadoDisponibilidad: estadoDisponibilidadCcDesde(pagado, cargo.importe) },
  });
}

/** Igual que `sincronizarCuentaCorrienteViajePorId`, para varios viajes (ej. los de una factura anulada). */
export async function sincronizarCuentaCorrienteViajesPorIds(
  tx: Prisma.TransactionClient,
  tenantId: string,
  viajeIds: string[],
  opts: OpcionesCcViaje = {},
) {
  for (const viajeId of new Set(viajeIds)) {
    await sincronizarCuentaCorrienteViajePorId(tx, tenantId, viajeId, opts);
  }
}
