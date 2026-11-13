/**
 * Conceptos de una factura además de sus viajes (nov 2026): estadía, carga y descarga, gastos
 * del viaje… Solo suman (no hay descuentos): ARCA no admite líneas ni totales negativos.
 * Se guardan en `Factura.conceptos` (Json). Sin catálogo, a diferencia de los conceptos de
 * liquidación. Espejo del front en `lib/facturaConceptos.ts`.
 */
export type FacturaConcepto = {
  descripcion: string;
  /** Cantidad (> 0). Conceptos guardados antes del campo: 1. */
  cantidad: number;
  /** Monto unitario sin IVA. Conceptos guardados antes del campo: el importe. */
  precioUnitario: number;
  /** Neto, sin IVA: cantidad × unitario (2 decimales). Siempre > 0. */
  importe: number;
  ivaPct: number;
};

const MAX_CONCEPTOS = 30;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Lee lo guardado (o lo que manda el cliente) y descarta lo inválido: sin descripción, sin
 * importe positivo o con IVA fuera de 0–100. Nunca tira: un Json raro da `[]`.
 */
export function normalizarConceptosFactura(raw: unknown): FacturaConcepto[] {
  if (!Array.isArray(raw)) return [];
  const out: FacturaConcepto[] = [];
  for (const c of raw.slice(0, MAX_CONCEPTOS)) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const descripcion = String(o.descripcion ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const ivaPct = Number(o.ivaPct ?? 0);
    // Con cantidad y unitario el importe sale de ellos (no se confía en el que venga); sin
    // ellos (conceptos anteriores al campo), cantidad 1 y unitario = importe.
    const cant = Number(o.cantidad);
    const unit = Number(o.precioUnitario);
    const conDesglose = o.cantidad != null && o.precioUnitario != null;
    const cantidad = conDesglose ? cant : 1;
    const importe = conDesglose ? round2(cant * unit) : round2(Number(o.importe));
    const precioUnitario = conDesglose ? unit : importe;
    if (
      !descripcion ||
      !(cantidad > 0) ||
      !(importe > 0) ||
      !Number.isFinite(ivaPct) ||
      ivaPct < 0 ||
      ivaPct > 100
    ) {
      continue;
    }
    out.push({ descripcion, cantidad, precioUnitario, importe, ivaPct });
  }
  return out;
}

/** Neto de los conceptos. */
export function netoConceptosFactura(conceptos: FacturaConcepto[]): number {
  return round2(conceptos.reduce((s, c) => s + c.importe, 0));
}

/** IVA de los conceptos (redondeado por concepto, igual que cada tramo). */
export function ivaConceptosFactura(conceptos: FacturaConcepto[]): number {
  return conceptos.reduce((s, c) => round2(s + round2((c.importe * c.ivaPct) / 100)), 0);
}
