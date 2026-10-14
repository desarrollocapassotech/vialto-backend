import { Prisma } from "@prisma/client";
import { ymdAr } from "../../shared/util/fecha-ar.util";
import { engrosarConIva } from "./viaje-ganancia-bruta.util";
import { numeroVisibleViaje } from "./viaje-numero-visible.util";

/**
 * Cuenta corriente generada desde un viaje (oct 2026: nace al CREAR el viaje, no al
 * finalizarlo). Funciones planas sobre un `TransactionClient`, mismo patrón que
 * `viaje-estado-financiero.ts`, para que las usen tanto `ViajesService` (alta/edición
 * manual) como `importaciones/processors/viajes.processor.ts` (carga masiva) sin que
 * un módulo dependa del otro.
 *
 * Reglas:
 * - Cliente (a cobrar): venta por `monto` + otros gastos en la misma moneda, si es > 0.
 *   Solo en tenants SIN Facturación: con Facturación el cargo nace de la factura.
 * - Proveedor/fletero (a pagar): compra por el acordado con el transportista externo
 *   (`calcularAcordadoTransportista`), si es > 0.
 * - Fecha = día de creación del viaje (en Argentina, a medianoche UTC). Concepto
 *   "... por creación del viaje X". Ambos se fijan al crear el movimiento y no se
 *   vuelven a tocar (tampoco en movimientos generados antes de este cambio).
 * - Mientras el cargo no tenga imputaciones, sigue al viaje: importe, moneda y estado.
 *   Con imputaciones queda congelado (requiere intervención manual).
 * - Viaje cancelado, importe que pasa a 0, o cambio de cliente/transportista: el cargo
 *   que ya no corresponde se anula si no tiene imputaciones. Un cargo anulado sin
 *   imputaciones se reactiva si vuelve a corresponder (ej. viaje que deja de estar
 *   cancelado).
 * - Finalizar el viaje no crea ni duplica nada: el cargo ya existe y solo lo sigue.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  liquidacionesViaje?: any[];
};

/** Include mínimo para poder calcular el acordado con el transportista (Liquidación vigente). */
export const VIAJE_CC_INCLUDE = {
  liquidacionesViaje: {
    include: {
      liquidacion: { include: { conceptosLineas: true, viajes: true } },
    },
  },
} satisfies Prisma.ViajeInclude;

/**
 * Si el tenant tiene Facturación (manual o ARCA), el cargo del cliente nace de la
 * factura emitida, no del viaje. Mismo OR que el resto del proyecto.
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
  if (pagado <= EPS) return "pendiente";
  if (pagado + EPS >= importe) return "cancelado";
  return "parcial";
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

async function tieneImputaciones(
  tx: Prisma.TransactionClient,
  tenantId: string,
  cargoId: string,
): Promise<boolean> {
  const imputado = await tx.imputacionCuentaCorriente.aggregate({
    where: { tenantId, cargoId },
    _sum: { importe: true },
  });
  return (imputado._sum.importe ?? 0) > 0;
}

type LadoCc = "cliente" | "proveedor";

/**
 * Deja en la cuenta corriente de un lado (cliente o proveedor) a lo sumo un cargo
 * vigente del viaje: el de `contraparteId` por `importe`. Cualquier otro cargo del
 * viaje en ese lado (otra contraparte, o importe 0) se anula si no tiene imputaciones.
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
  const existentes = await tx.movimientoCuentaCorriente.findMany({
    where: {
      tenantId: viaje.tenantId,
      viajeId: viaje.id,
      tipo: "cargo",
      origen: "viaje",
      ...(lado === "cliente" ? { clienteId: { not: null } } : { proveedorId: { not: null } }),
    },
  });

  const corresponde = objetivo.importe > EPS && !!objetivo.contraparteId;
  const actual = corresponde
    ? existentes.find((m) => m.contraparteId === objetivo.contraparteId)
    : undefined;

  for (const m of existentes) {
    if (m === actual || m.estadoDisponibilidad === "anulado") continue;
    if (await tieneImputaciones(tx, viaje.tenantId, m.id)) continue;
    await tx.movimientoCuentaCorriente.update({
      where: { id: m.id },
      data: { estadoDisponibilidad: "anulado" },
    });
  }

  if (!corresponde) return;

  if (actual) {
    if (await tieneImputaciones(tx, viaje.tenantId, actual.id)) return;
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

  const numeroVisible = numeroVisibleViaje(viaje);
  const contraparteId = objetivo.contraparteId!;
  await tx.movimientoCuentaCorriente.create({
    data: {
      tenantId: viaje.tenantId,
      ...(lado === "cliente" ? { clienteId: contraparteId } : { proveedorId: contraparteId }),
      contraparteId,
      viajeId: viaje.id,
      tipo: "cargo",
      origen: "viaje",
      concepto: `${lado === "cliente" ? "Venta" : "Compra"} automática por creación del viaje ${numeroVisible}`,
      importe: objetivo.importe,
      moneda: objetivo.moneda,
      fecha: fechaCreacionViaje(viaje.createdAt),
      referencia: numeroVisible,
      estadoDisponibilidad: objetivo.estadoDisponibilidad,
    },
  });
}

/**
 * Crea o actualiza los cargos de cuenta corriente del viaje (cliente y proveedor)
 * según su estado actual. Idempotente: llamarlo después de cada alta/edición del
 * viaje (o al agregar un gasto) deja la cuenta alineada con el viaje.
 */
export async function sincronizarCuentaCorrienteViaje(
  tx: Prisma.TransactionClient,
  viaje: ViajeParaCuentaCorriente,
  opts: { ivaTransportistaHabilitado: boolean; conFacturacion: boolean },
) {
  const cancelado = viaje.etapa === "cancelado";

  // Con Facturación el lado cliente nace de la factura. Igual se anula al cancelar,
  // por si quedó un cargo de viaje de antes de que el tenant tuviera Facturación.
  if (!opts.conFacturacion || cancelado) {
    await sincronizarLado(tx, viaje, "cliente", {
      contraparteId: viaje.clienteId,
      importe: cancelado ? 0 : montoCargoCliente(viaje),
      moneda: monedaNormalizada(viaje.monedaMonto),
      estadoDisponibilidad: "pendiente",
    });
  }

  const moneda = monedaNormalizada(viaje.monedaPrecioTransportistaExterno);
  const acordado =
    cancelado || !viaje.transportistaId || !viaje.precioTransportistaExterno
      ? 0
      : calcularAcordadoTransportista(viaje, opts.ivaTransportistaHabilitado);
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

/** Variante que carga el viaje por id (para quien no lo tiene ya con `liquidacionesViaje`). */
export async function sincronizarCuentaCorrienteViajePorId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  viajeId: string,
  opts: { ivaTransportistaHabilitado: boolean; conFacturacion: boolean },
) {
  const viaje = await tx.viaje.findFirstOrThrow({
    where: { id: viajeId, tenantId },
    include: VIAJE_CC_INCLUDE,
  });
  await sincronizarCuentaCorrienteViaje(tx, viaje, opts);
}
