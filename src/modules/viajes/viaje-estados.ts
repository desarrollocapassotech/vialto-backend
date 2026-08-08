/**
 * Etapa operativa del viaje — reemplaza el antiguo `estado` combinado
 * (que mezclaba etapa + facturación + cobro). Facturación y liquidación
 * viven en `Viaje.facturacionEstado` / `Viaje.liquidacionEstado`
 * (ver `viaje-estado-financiero.ts`), sincronizadas automáticamente y
 * nunca editables a mano.
 */
export const VIAJE_ETAPAS = [
  'pendiente',
  'en_curso',
  'finalizado',
  'cancelado',
] as const;

export type ViajeEtapa = (typeof VIAJE_ETAPAS)[number];

/** Valores posibles en BD/API (evita fallos con `.includes` y lookups). */
export const VIAJE_ETAPAS_SET = new Set<string>(VIAJE_ETAPAS as unknown as string[]);

/** Solo estados permitidos al crear un viaje (no se crea ya finalizado). */
export const VIAJE_ETAPAS_ALTA = ['pendiente', 'en_curso', 'cancelado'] as const;

export function esEtapaFinal(etapa: string): boolean {
  return etapa === 'finalizado';
}

/** Nombres previos a la migración de split (`estado` combinado → `etapa` + indicadores). */
const LEGACY_ETAPA: Record<string, string> = {
  cerrado: 'finalizado',
  en_transito: 'en_curso',
  despachado: 'en_curso',
  finalizado_facturado: 'finalizado',
  finalizado_cobrado: 'finalizado',
  finalizado_sin_facturar: 'finalizado',
  facturado_sin_cobrar: 'finalizado',
  cobrado: 'finalizado',
};

/**
 * Acepta valores legados del `estado` combinado (pre-split) y los colapsa a la
 * etapa correspondiente. Alinea mayúsculas/espacios con los códigos canónicos.
 */
export function normalizarEtapaViaje(etapa: string): string {
  const t = String(etapa).trim();
  if (t === '') return t;

  const key = t.toLowerCase();
  if (key in LEGACY_ETAPA) return LEGACY_ETAPA[key];

  const list = VIAJE_ETAPAS as readonly string[];
  const direct = list.find((s) => s === t);
  if (direct) return direct;

  const slug = key.replace(/\s+/g, '_');
  const bySlug = list.find((s) => s === slug);
  if (bySlug) return bySlug;

  return t;
}

/** Facturación al cliente — derivado y sincronizado, nunca editable a mano. */
export const VIAJE_FACTURACION_ESTADOS = [
  'sin_facturar',
  'esperando_afip',
  'facturado',
  'cobrado',
  'error_afip',
  'anulado',
] as const;

export type ViajeFacturacionEstado = (typeof VIAJE_FACTURACION_ESTADOS)[number];

/** Facturación estados que cuentan como "viaje disponible para vincular a una factura nueva". */
export const FACTURACION_ESTADOS_DISPONIBLES: readonly ViajeFacturacionEstado[] = [
  'sin_facturar',
  'anulado',
];

/** Liquidación al transportista — mismo patrón que facturación; `null` si no aplica. */
export const VIAJE_LIQUIDACION_ESTADOS = [
  'sin_liquidar',
  'esperando_afip',
  'liquidado',
  'error_afip',
  'anulado',
] as const;

export type ViajeLiquidacionEstado = (typeof VIAJE_LIQUIDACION_ESTADOS)[number];

export const LIQUIDACION_ESTADOS_DISPONIBLES: readonly ViajeLiquidacionEstado[] = [
  'sin_liquidar',
  'anulado',
];
