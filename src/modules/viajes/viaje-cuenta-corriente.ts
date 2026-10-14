import { Prisma } from "@prisma/client";
import { estadoDisponibilidadPorMonto } from "../../shared/cuenta-corriente/movimiento-cc.util";
import { engrosarConIva } from "./viaje-ganancia-bruta.util";

/**
 * Cálculos de viaje que usa la cuenta corriente. La cuenta corriente depende SOLO de
 * facturas y liquidaciones (oct 2026): crear o editar un viaje no genera movimientos.
 * Lo que queda acá son cálculos compartidos (funciones planas, sin DI):
 * - `calcularAcordadoTransportista`: lo acordado con el transportista (lo usan Viajes y
 *   el saldo de pagos al transportista).
 * - `actualizarEstadoCargoLiquidacionCc`: estado de pago del movimiento de una liquidación.
 */

export function estadoDisponibilidadCcDesde(pagado: number, importe: number): string {
  return estadoDisponibilidadPorMonto(pagado, importe);
}

function monedaNormalizada(m: string | null | undefined): "ARS" | "USD" {
  return m === "USD" ? "USD" : "ARS";
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
