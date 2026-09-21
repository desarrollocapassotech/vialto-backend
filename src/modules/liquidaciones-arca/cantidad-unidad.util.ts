/** Unidad de cantidad de flete configurable por tenant — ver `Tenant.unidadCantidadViajes`. */
export type UnidadCantidad = 'TN' | 'UD';

export function normalizeUnidadCantidad(raw: string | null | undefined): UnidadCantidad {
  return raw === 'UD' ? 'UD' : 'TN';
}

/**
 * Header de la columna "Cantidad" en las tablas de comprobante (Factura A/B, CVLP 60):
 * "Toneladas" si el tenant factura por TN, "Cantidad" si factura por unidades.
 */
export function headerCantidad(raw: string | null | undefined): string {
  return normalizeUnidadCantidad(raw) === 'UD' ? 'Cantidad' : 'Toneladas';
}

/** Palabra en plural minúscula para textos descriptivos (ej. "Cantidad de toneladas"). */
export function unidadCantidadPlural(raw: string | null | undefined): string {
  return normalizeUnidadCantidad(raw) === 'UD' ? 'unidades' : 'toneladas';
}
