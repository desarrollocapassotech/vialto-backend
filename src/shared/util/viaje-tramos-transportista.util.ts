/**
 * IVA por tramo en el pago al transportista (pedido LSF, nov 2026).
 *
 * Un transportista uruguayo cobra IVA solo sobre la parte del recorrido hecha en
 * Uruguay. En vez de un único % sobre todo el precio, el viaje puede llevar tramos
 * (`Viaje.tramosTransportista`, Json `[{ detalle, monto, ivaPct }]`), igual que los
 * tramos de una factura. Genérico: cualquier %, cualquier transportista y país.
 *
 * Reglas:
 * - El precio del transportista sigue siendo el neto completo del viaje; los tramos
 *   no lo reemplazan. Lo que no cubren usa el % general del viaje
 *   (`precioTransportistaIvaIncluidoPct`).
 * - Sin tramos, el cálculo es exactamente el de siempre (un % sobre todo el neto).
 * - La suma de los tramos no puede superar el neto (`validarTramosTransportista`).
 *
 * Única fuente de esta cuenta en el backend; espejo en el front:
 * `vialto-frontend/src/lib/viajeTramosTransportista.ts`.
 */

export type TramoTransportista = {
  detalle: string;
  monto: number;
  ivaPct: number;
};

/** Parte del neto con su alícuota (tramos + resto). */
export type ParteIvaTransportista = { base: number; ivaPct: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lee el Json guardado y descarta lo inválido (monto ≤ 0, % fuera de 0–100). */
export function normalizarTramosTransportista(raw: unknown): TramoTransportista[] {
  if (!Array.isArray(raw)) return [];
  const out: TramoTransportista[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const monto = Number(r.monto);
    const ivaPct = Number(r.ivaPct);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    if (!Number.isFinite(ivaPct) || ivaPct < 0 || ivaPct > 100) continue;
    out.push({
      detalle: typeof r.detalle === "string" ? r.detalle.trim() : "",
      monto: round2(monto),
      ivaPct,
    });
  }
  return out;
}

/**
 * Desglose del neto por alícuota: cada tramo con su % y el resto (neto − tramos) con
 * el % general. Sin tramos devuelve `[]` (el llamador sigue con el cálculo de siempre).
 */
export function partesIvaTransportista(
  neto: number,
  pctGeneral: number | null | undefined,
  tramosRaw: unknown,
): ParteIvaTransportista[] {
  const tramos = normalizarTramosTransportista(tramosRaw);
  if (tramos.length === 0) return [];
  const partes: ParteIvaTransportista[] = tramos.map((t) => ({
    base: t.monto,
    ivaPct: t.ivaPct,
  }));
  const suma = round2(tramos.reduce((s, t) => s + t.monto, 0));
  const resto = round2((Number(neto) || 0) - suma);
  if (resto > 0) {
    partes.push({ base: resto, ivaPct: Number(pctGeneral) || 0 });
  }
  return partes;
}

/**
 * Para la liquidación: partes del bruto del viaje por alícuota, o `undefined` si no
 * tiene tramos (la liquidación sigue con el % del viaje, como siempre).
 */
export function tramosIvaParaLiquidacion(
  bruto: number,
  pctGeneral: number | null | undefined,
  tramosRaw: unknown,
): ParteIvaTransportista[] | undefined {
  const partes = partesIvaTransportista(bruto, pctGeneral, tramosRaw);
  return partes.length > 0 ? partes : undefined;
}

/** IVA total que se le suma al transportista sobre el neto. */
export function ivaTransportista(
  neto: number,
  pctGeneral: number | null | undefined,
  tramosRaw?: unknown,
): number {
  const partes = partesIvaTransportista(neto, pctGeneral, tramosRaw);
  if (partes.length === 0) {
    const p = Number(pctGeneral) || 0;
    if (p <= 0) return 0;
    return round2(engrosarSinTramos(neto, p) - neto);
  }
  return round2(
    partes.reduce((s, p) => s + (p.ivaPct > 0 ? round2((p.base * p.ivaPct) / 100) : 0), 0),
  );
}

function engrosarSinTramos(neto: number, p: number): number {
  return Math.round(neto * (1 + p / 100) * 100) / 100;
}

/**
 * Neto + IVA: lo que se le paga en efectivo al transportista. Sin tramos es la fórmula
 * de siempre, sin cambios (mismo redondeo).
 */
export function engrosarConIva(
  precioNeto: number,
  pct: number | null | undefined,
  tramosRaw?: unknown,
): number {
  if (normalizarTramosTransportista(tramosRaw).length === 0) {
    const p = Number(pct) || 0;
    if (p <= 0) return precioNeto;
    return engrosarSinTramos(precioNeto, p);
  }
  return round2(precioNeto + ivaTransportista(precioNeto, pct, tramosRaw));
}

/** Mensaje de error si los tramos no son válidos para ese neto; null si están bien. */
export function validarTramosTransportista(
  tramosRaw: unknown,
  neto: number | null | undefined,
): string | null {
  if (!Array.isArray(tramosRaw) || tramosRaw.length === 0) return null;
  const normalizados = normalizarTramosTransportista(tramosRaw);
  if (normalizados.length !== tramosRaw.length) {
    return "Hay un tramo incompleto: cada tramo necesita un monto mayor a 0 y un % de IVA entre 0 y 100.";
  }
  if (normalizados.some((t) => !t.detalle)) {
    return "Cada tramo necesita una descripción.";
  }
  const suma = round2(normalizados.reduce((s, t) => s + t.monto, 0));
  const n = Number(neto) || 0;
  if (n <= 0) {
    return "Para cargar tramos, primero cargá el precio del transportista.";
  }
  if (suma > round2(n) + 0.005) {
    return `La suma de los tramos (${suma.toFixed(2)}) no puede superar el precio del transportista (${round2(n).toFixed(2)}).`;
  }
  return null;
}
