/**
 * Colores de un PDF de comprobante (Factura/NC y CVLP/anulación) a partir del color de
 * acento que la empresa eligió en ArcaConfig (`colorFactura` / `colorLiquidacion`).
 *
 * Cada método recibe el color que el PDF usaba hasta ahora: sin color configurado (o
 * inválido) lo devuelve tal cual, así el comprobante queda idéntico al de siempre.
 */
export type PdfColoresComprobante = {
  /** Bordes de los recuadros principales y líneas divisorias. */
  linea: (porDefecto: string) => string;
  /** Texto destacado: ORIGINAL/DUPLICADO, letra y título del comprobante. */
  texto: (porDefecto: string) => string;
  /** Fondo del encabezado de la tabla de ítems. */
  fondoEncabezadoTabla: (porDefecto: string) => string;
  /** Texto sobre el fondo del encabezado de la tabla (blanco o negro según el contraste). */
  textoEncabezadoTabla: (porDefecto: string) => string;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function pdfColoresComprobante(color: string | null | undefined): PdfColoresComprobante {
  const c = String(color ?? '').trim();
  if (!HEX.test(c)) {
    const igual = (porDefecto: string) => porDefecto;
    return { linea: igual, texto: igual, fondoEncabezadoTabla: igual, textoEncabezadoTabla: igual };
  }
  const lum = luminancia(c);
  return {
    linea: () => c,
    // Un acento muy claro (ej. amarillo) no se lee como texto sobre blanco: queda el de siempre.
    texto: (porDefecto) => (lum > 0.6 ? porDefecto : c),
    fondoEncabezadoTabla: () => c,
    textoEncabezadoTabla: () => (lum > 0.5 ? '#000' : '#fff'),
  };
}

/** Luminancia relativa (0 = negro, 1 = blanco). */
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
