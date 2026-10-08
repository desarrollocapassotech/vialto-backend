/** Unidad de cantidad de flete configurable por tenant — ver `Tenant.unidadCantidadViajes`. */
export type UnidadCantidad = 'TN' | 'UD';

export function normalizeUnidadCantidad(raw: string | null | undefined): UnidadCantidad {
  return raw === 'UD' ? 'UD' : 'TN';
}

/** Palabra en plural minúscula para textos descriptivos (ej. "Cantidad de toneladas"). */
export function unidadCantidadPlural(raw: string | null | undefined): string {
  return normalizeUnidadCantidad(raw) === 'UD' ? 'unidades' : 'toneladas';
}
