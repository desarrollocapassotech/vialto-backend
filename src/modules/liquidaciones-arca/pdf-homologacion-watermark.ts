import { normalizeArcaAmbiente } from './arca.util';

/** Dimensiones A4 usadas por los PDFs ARCA (CVLP / Factura / NC). */
const PAGE_W = 595.28;
const PAGE_H = 841.89;

/**
 * Misma condición que el PDF de CVLP: marca de agua si ArcaConfig.ambiente
 * no es producción (homologación / default).
 */
export function shouldShowHomologacionWatermark(ambiente: unknown): boolean {
  return normalizeArcaAmbiente(ambiente) !== 'produccion';
}

/**
 * Marca de agua diagonal en homologación/testing.
 * Se dibuja al final de cada página (por encima del contenido, traslúcida).
 * Implementación compartida CVLP ↔ Factura A/B ↔ NC A/B.
 */
export function drawHomologacionWatermark(doc: PDFKit.PDFDocument): void {
  doc.save();
  doc.opacity(0.16);
  doc.fillColor('#b71c1c');
  doc.font('Helvetica-Bold');

  const cx = PAGE_W / 2;
  const cy = PAGE_H / 2;
  doc.translate(cx, cy);
  doc.rotate(-42);

  // Ancho de la diagonal de la hoja A4 para que la banda cruce todo el documento.
  const bandW = Math.sqrt(PAGE_W * PAGE_W + PAGE_H * PAGE_H);
  doc.fontSize(28).text('COMPROBANTE DE PRUEBA', -bandW / 2, -28, {
    width: bandW,
    align: 'center',
    lineBreak: false,
  });
  doc.fontSize(22).text('SIN VALIDEZ FISCAL', -bandW / 2, 8, {
    width: bandW,
    align: 'center',
    lineBreak: false,
  });

  doc.restore();
}
