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
/**
 * `borrador` (solo tenants con ARCA): el viaje ya tiene una factura vinculada que
 * todavía no se emitió. Antes se mostraba como `sin_facturar`, lo que invitaba a
 * "Facturar" de nuevo; ahora la UI lleva a ese borrador en vez de crear otro.
 */
export const VIAJE_FACTURACION_ESTADOS = [
  'sin_facturar',
  'borrador',
  'esperando_afip',
  'facturado',
  'cobrado',
  'error_afip',
  'anulado',
] as const;

export type ViajeFacturacionEstado = (typeof VIAJE_FACTURACION_ESTADOS)[number];

/**
 * Estados de facturación que NO bloquean editar los campos fiscales del viaje (ni
 * agregar gastos, ni cambiar sus clientes). `borrador` entra porque el comprobante
 * todavía no se mandó a AFIP — mismo comportamiento que cuando se mostraba como
 * `sin_facturar`. Ojo: vincular el viaje a una factura NUEVA es otra regla
 * (`facturaId` nulo o factura anulada, ver `facturaDisponibleWhere`).
 */
export const FACTURACION_ESTADOS_DISPONIBLES: readonly ViajeFacturacionEstado[] = [
  'sin_facturar',
  'borrador',
  'anulado',
];

/**
 * Estados que cuentan como "pendiente de facturar" en conteos y filtros (dashboard,
 * resumen de Viajes): un borrador sin emitir sigue pendiente.
 */
export const FACTURACION_ESTADOS_PENDIENTES: readonly ViajeFacturacionEstado[] = [
  'sin_facturar',
  'borrador',
];

/**
 * Liquidación al transportista — mismo patrón que facturación; `null` si no aplica.
 * `borrador` (solo tenants con ARCA): liquidación cargada que todavía no se emitió
 * (antes caía en `esperando_afip`, que daba a entender que ya se había mandado a AFIP).
 */
export const VIAJE_LIQUIDACION_ESTADOS = [
  'sin_liquidar',
  'borrador',
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
