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

  // Totales AFIP desde AlicIva (BaseImp > 0 y BaseImp × % por Id).
  const alicuotasIva = groupAlicuotasIva(items, { fallbackIvaPct: ivaPctDefault });
  let impNeto: number;
  let impIva: number;
  if (alicuotasIva.length > 0) {
    impNeto = round2(alicuotasIva.reduce((s, a) => s + a.BaseImp, 0));
    impIva = round2(alicuotasIva.reduce((s, a) => s + a.Importe, 0));
  } else {
    // Neto ≤ 0 (p. ej. anulación): sin AlicIva; totales desde líneas.
    impNeto = round2(items.reduce((s, i) => s + i.importeBase, 0));
    impIva = round2(items.reduce((s, i) => s + i.importeIva, 0));
  }

  return {
    ...cabeceraBase,
    impNeto,
    impIva,
    impTotal: round2(impNeto + impIva),
    alicuotasIva,
    items,
  };
}

export function mapCvlpToArcaRequest(cvlp: ArcaComprobanteCvlp, ambiente: 'homologacion'|'produccion'): ArcaAutorizarRequest {
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
  };
}
