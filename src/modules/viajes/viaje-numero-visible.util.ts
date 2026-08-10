/**
 * ID que se muestra en toda vista/documento humano de un viaje: el ID personalizado del
 * cliente (ej. CTG) si está cargado, o el correlativo interno autogenerado si no.
 */
export function numeroVisibleViaje(v: {
  numero: string;
  numeroIdentificacionPersonalizado?: string | null;
}): string {
  return v.numeroIdentificacionPersonalizado?.trim() || v.numero;
}
