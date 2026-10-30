/**
 * Nombre del PDF de un comprobante con el tipo y el número, como lo descarga ARCA:
 * "Factura B 00002-00001532.pdf", "Nota de Crédito A 00001-00000004.pdf" (pedido NyM, oct 2026).
 * Sin número autorizado (borrador) usa `sinNumero` en su lugar.
 */
export function nombreArchivoComprobante(
  tipo: string,
  ptoVenta: number | null | undefined,
  cbteNro: number | null | undefined,
  sinNumero: string,
): string {
  const numero =
    cbteNro && ptoVenta != null
      ? `${String(ptoVenta).padStart(5, '0')}-${String(cbteNro).padStart(8, '0')}`
      : sinNumero;
  // Sin caracteres que Windows/macOS no aceptan en un nombre de archivo.
  return `${tipo} ${numero}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf';
}

/** Tipo legible de un comprobante AFIP por código (facturas, NC/ND y CVLP). */
export function tipoComprobanteLegible(cbteTipo: number | null | undefined): string {
  switch (cbteTipo) {
    case 1:
      return 'Factura A';
    case 2:
      return 'Nota de Débito A';
    case 3:
      return 'Nota de Crédito A';
    case 6:
      return 'Factura B';
    case 7:
      return 'Nota de Débito B';
    case 8:
      return 'Nota de Crédito B';
    case 11:
      return 'Factura C';
    case 60:
      return 'Liquido Producto A';
    case 61:
      return 'Liquido Producto B';
    default:
      return cbteTipo != null ? `Comprobante ${String(cbteTipo).padStart(3, '0')}` : 'Comprobante';
  }
}

/**
 * `Content-Disposition` de descarga con acentos: `filename` en ASCII (fallback para clientes
 * viejos) + `filename*` en UTF-8 (RFC 5987), que es el que leen el navegador y el front.
 */
export function contentDispositionAdjunto(filename: string): string {
  const ascii = filename
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
