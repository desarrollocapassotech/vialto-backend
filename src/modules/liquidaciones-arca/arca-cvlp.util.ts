import { computeAfipGravadoIva, groupAlicuotasIva, round2 } from './arca-iva.util';
import { ArcaAutorizarRequest, ArcaComprobanteCvlp, ArcaComprobanteItem } from './types/arca.types';

export interface ConceptoFacturable {
  descripcion: string;
  cantidad?: number;
  precioUnitario?: number;
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
      cantidad: c.cantidad,
      precioUnitario: c.precioUnitario,
      importeBase: montos.impNeto,
      ivaPct: pct,
      importeIva: montos.impIva,
      subtotal: montos.liquido,
    });
  }

  const impNeto = round2(items.reduce((s, i) => s + i.importeBase, 0));

  // AlicIva para WSFEv1: Importe = BaseImp neta × % oficial (AFIP 10051).
  const alicuotasIva = groupAlicuotasIva(items, {
    fallbackIvaPct: ivaPctDefault,
  });

  // AFIP 10023: ImpIVA DEBE ser la suma de AlicIva.Importe.
  // La suma de IVAs redondeados por línea puede diferir en centavos
  // (ej. 200.06 − 100.03 → líneas 21.00 vs AlicIva 21.01).
  // Sin AlicIva (neto ≤ 0 / anulación) se conserva la suma de líneas.
  const ivaLineas = round2(items.reduce((s, i) => s + i.importeIva, 0));
  const impIva =
    alicuotasIva.length > 0
      ? round2(alicuotasIva.reduce((s, a) => s + a.Importe, 0))
      : ivaLineas;

  // Ajustar detalle para que Σ importeIva === ImpIVA (inyectar en la línea de mayor |base|).
  const diffIva = round2(impIva - ivaLineas);
  if (diffIva !== 0 && items.length > 0) {
    let idx = 0;
    let maxAbs = Math.abs(items[0].importeBase);
    for (let i = 1; i < items.length; i++) {
      const abs = Math.abs(items[i].importeBase);
      if (abs > maxAbs) {
        maxAbs = abs;
        idx = i;
      }
    }
    const importeIva = round2(items[idx].importeIva + diffIva);
    items[idx] = {
      ...items[idx],
      importeIva,
      subtotal: round2(items[idx].importeBase + importeIva),
    };
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
