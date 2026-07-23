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
  let impNeto = 0;
  let impIva = 0;

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
    impNeto = round2(impNeto + montos.impNeto);
    impIva = round2(impIva + montos.impIva);
  }

  return {
    ...cabeceraBase,
    impNeto,
    impIva,
    impTotal: round2(impNeto + impIva),
    alicuotasIva: groupAlicuotasIva(items),
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
