/** Estados finales (reemplazan el antiguo `finalizado`). */
export const VIAJE_ESTADOS_FINALES = [
  'finalizado_sin_facturar',
  'facturado_sin_cobrar',
  'cobrado',
] as const;

export const VIAJE_ESTADOS = [
  'pendiente',
  'en_curso',
  ...VIAJE_ESTADOS_FINALES,
  'cancelado',
] as const;

export type ViajeEstado = (typeof VIAJE_ESTADOS)[number];

/** Valores posibles en BD/API (evita fallos con `.includes` y lookups). */
export const VIAJE_ESTADOS_SET = new Set<string>(VIAJE_ESTADOS as unknown as string[]);

export function esEstadoViajeFinal(estado: string): boolean {
  return (VIAJE_ESTADOS_FINALES as readonly string[]).includes(estado);
}

/**
 * Viajes “completados” para métricas (finalizado sin facturar, facturado sin cobrar, cobrado)
 * más códigos legados que aún pueden existir en filas antiguas de la BD.
 */
export const VIAJE_ESTADOS_COMPLETADOS_TABLERO: readonly string[] = [
  ...VIAJE_ESTADOS_FINALES,
  'finalizado',
  'finalizado_facturado',
  'finalizado_cobrado',
  'cerrado',
];

/** Nombres previos a las migraciones de unificación (ver 20260401120000_viajes_estado_cc_tablero). */
const LEGACY_ESTADO: Record<string, string> = {
  cerrado: 'finalizado_sin_facturar',
  en_transito: 'en_curso',
  despachado: 'en_curso',
  /** Antes `finalizado_facturado`; ahora `facturado_sin_cobrar`. */
  finalizado_facturado: 'facturado_sin_cobrar',
  /** Antes `finalizado_cobrado`; ahora `cobrado`. */
  finalizado_cobrado: 'cobrado',
};

/**
 * Compat: legado `finalizado` → `finalizado_sin_facturar`.
 * Alinea mayúsculas / espacios con los códigos canónicos de {@link VIAJE_ESTADOS}.
 */
export function normalizarEstadoViaje(estado: string): string {
  const t = String(estado).trim();
  if (t === '') return t;

  const key = t.toLowerCase();
  if (key in LEGACY_ESTADO) return LEGACY_ESTADO[key];

  if (t === 'finalizado' || key === 'finalizado') return 'finalizado_sin_facturar';

  const list = VIAJE_ESTADOS as readonly string[];
  const direct = list.find((s) => s === t);
  if (direct) return direct;

  const slug = t.toLowerCase().replace(/\s+/g, '_');
  const bySlug = list.find((s) => s === slug);
  if (bySlug) return bySlug;

  const lower = t.toLowerCase();
  const byCi = list.find((s) => s.toLowerCase() === lower);
  if (byCi) return byCi;

  return t;
}
