import { computeAfipGravadoIva, groupAlicuotasIva, round2 } from './arca-iva.util';
import { ArcaAutorizarRequest, ArcaComprobanteCvlp, ArcaComprobanteItem } from './types/arca.types';

export interface ConceptoFacturable {
  descripcion: string;
  importe: number; // Positivo (ingreso) o negativo (descuento)
  /** Si se omite, se usa el `ivaPct` global pasado a buildComprobanteCvlp. */
  ivaPct?: number;
}

/**
 * Construye el objeto interno de dominio ArcaComprobanteCvlp, el cual contiene
 * los totales compatibles con el SDK de AFIP y el detalle de ítems para auditoría.
 */
export function buildComprobanteCvlp(
  cabeceraBase: Omit<ArcaComprobanteCvlp, 'impNeto' | 'impIva' | 'impTotal' | 'alicuotasIva' | 'items'>,
  conceptos: ConceptoFacturable[],
  ivaPctDefault: number,
): ArcaComprobanteCvlp {
  const conceptosFiltrados = conceptos.filter((c) => c.importe !== 0);

  const items: ArcaComprobanteItem[] = [];

  for (const c of conceptosFiltrados) {
    const pct = c.ivaPct ?? ivaPctDefault;
    const montos = computeAfipGravadoIva(c.importe, 0, 0, pct);

    items.push({
      descripcion: c.descripcion,
      importeBase: montos.impNeto,
      ivaPct: pct,
      importeIva: montos.impIva,
      subtotal: montos.liquido,
    });
  }

  // Totales de negocio = suma de líneas con el IVA configurado (no AlicIva AFIP,
  // que remapea tasas no oficiales — p.ej. 10% — a 21% y pisaba el valor del usuario).
  const impNeto = round2(items.reduce((s, i) => s + i.importeBase, 0));
  const impIva = round2(items.reduce((s, i) => s + i.importeIva, 0));

  // AlicIva para WSFEv1 (Ids oficiales). Puede diferir si la alícuota no es de AFIP.
  const alicuotasIva = groupAlicuotasIva(items, { fallbackIvaPct: ivaPctDefault });

  return {
    ...cabeceraBase,
    impNeto,
    impIva,
    impTotal: round2(impNeto + impIva),
    alicuotasIva,
    items,
  };
}

export function mapCvlpToArcaRequest(
  cvlp: ArcaComprobanteCvlp,
  ambiente: 'homologacion' | 'produccion',
  cbtesAsoc?: ArcaAutorizarRequest['cbtesAsoc'],
): ArcaAutorizarRequest {
  return {
    ambiente,
    cuit: cvlp.cuit,
    ptoVenta: cvlp.ptoVenta,
    cbteTipo: cvlp.cbteTipo,
    cbteNro: cvlp.cbteNro,
    fechaCbte: cvlp.fechaCbte,
    concepto: cvlp.concepto,
    docTipo: cvlp.docTipo,
    docNro: cvlp.docNro,
    condicionIvaReceptorId: cvlp.condicionIvaReceptorId,
    impNeto: cvlp.impNeto,
    impIva: cvlp.impIva,
    impTotal: cvlp.impTotal,
    alicuotasIva: cvlp.alicuotasIva,
    ...(cbtesAsoc?.length ? { cbtesAsoc } : {}),
  };
}
