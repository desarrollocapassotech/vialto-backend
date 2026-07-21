import { computeAfipGravadoIva, round2 } from './arca-iva.util';
import { ArcaAutorizarRequest, ArcaComprobanteCvlp, ArcaComprobanteItem } from './types/arca.types';

export interface ConceptoFacturable {
  descripcion: string;
  importe: number; // Positivo (ingreso) o negativo (descuento)
}

/**
 * Construye el objeto interno de dominio ArcaComprobanteCvlp, el cual contiene
 * los totales compatibles con el SDK de AFIP y el detalle de ítems para auditoría.
 *
 * @param cabeceraBase Los datos de la cabecera del comprobante (Cuit, Punto de Venta, etc)
 * @param conceptos Arreglo de conceptos a facturar (flete, comisión, etc)
 * @param ivaPct El porcentaje de IVA a aplicar
 * @returns El objeto ArcaComprobanteCvlp completo
 */
export function buildComprobanteCvlp(
  cabeceraBase: Omit<ArcaComprobanteCvlp, 'impNeto' | 'impIva' | 'impTotal' | 'alicuotasIva' | 'items'>,
  conceptos: ConceptoFacturable[],
  ivaPct: number,
): ArcaComprobanteCvlp {
  // 1. Filtrar conceptos válidos (ignorar importes en cero)
  const conceptosFiltrados = conceptos.filter((c) => c.importe !== 0);

  // 2. Armar ítems y sumar IVA acumulado para calcular redondeos
  const items: ArcaComprobanteItem[] = [];
  let sumaIvaItems = 0;

  for (const c of conceptosFiltrados) {
    // Reutilizamos computeAfipGravadoIva pasando el importe neto en 'bruto'
    // Dado que netoGravado = bruto - comision - gastosAdmin,
    // pasar (importe, 0, 0) garantiza netoGravado = importe, conservando el signo.
    const montos = computeAfipGravadoIva(c.importe, 0, 0, ivaPct);

    items.push({
      descripcion: c.descripcion,
      importeBase: montos.impNeto,
      ivaPct,
      importeIva: montos.impIva,
      subtotal: montos.liquido,
    });
    sumaIvaItems += montos.impIva;
  }

  // 3. Calcular totales globales para AFIP usando el motor
  const totalBruto = conceptosFiltrados.reduce((acc, c) => acc + c.importe, 0);

  const totales = computeAfipGravadoIva(totalBruto, 0, 0, ivaPct);

  // 4. Ajuste por redondeo contable
  // Si hay diferencia de centavos entre el total general y la suma de las líneas,
  // ajustamos la diferencia en la línea de mayor importe (típicamente el flete).
  const diferenciaIva = round2(totales.impIva - sumaIvaItems);
  if (diferenciaIva !== 0 && items.length > 0) {
    let maxIdx = 0;
    let maxImporte = 0;
    for (let i = 0; i < items.length; i++) {
      const absImporte = Math.abs(items[i].importeBase);
      if (absImporte > maxImporte) {
        maxImporte = absImporte;
        maxIdx = i;
      }
    }

    items[maxIdx].importeIva = round2(items[maxIdx].importeIva + diferenciaIva);
    items[maxIdx].subtotal = round2(items[maxIdx].importeBase + items[maxIdx].importeIva);
  }

  return {
    ...cabeceraBase,
    impNeto: totales.impNeto,
    impIva: totales.impIva,
    impTotal: totales.liquido,
    alicuotasIva: [totales.alicuota],
    items,
  };
}

/**
 * Transforma el modelo de dominio interno al DTO estricto que consume el SDK de AFIP,
 * añadiendo los campos requeridos vacíos que el cliente completará.
 */
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
