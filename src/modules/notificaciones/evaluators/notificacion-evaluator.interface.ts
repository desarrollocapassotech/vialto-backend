/** Urgencia de un aviso: define el color de la tarjeta en el email (rojo / ámbar / neutro). */
export type NotificacionTono = 'alerta' | 'aviso' | 'info';

/** Un aviso candidato: una fila que va a un email agrupado por tipo de notificación. */
export type NotificacionItem = {
  /** id de la entidad que originó el aviso (ej. facturaId, cargaCombustibleId) — clave de dedup en `NotificacionEnvio`. */
  entidadId: string;
  /** Texto principal. Se guarda en `NotificacionEnvio` (campana) y es el título de la tarjeta del email. */
  titulo: string;
  /** Texto completo en una línea. Se guarda en `NotificacionEnvio` (campana); el email lo usa si no hay `subtitulo`/`etiqueta`. */
  detalle: string;

  // ── Opcionales: solo mejoran el email y la campana, un aviso sin ellos se ve como tarjeta simple ──

  /** Ruta de la app (sin `#`, ej. `/facturacion?factura=…`) que abre el registro. Botón "Ver" de la tarjeta y click en la campana. */
  url?: string;
  /** Agrupa las tarjetas del email bajo un subtítulo (ej. "Vencidos", "Vencen pronto"), en el orden en que aparecen. */
  seccion?: string;
  tono?: NotificacionTono;
  /** Línea secundaria de la tarjeta (ej. "A cobrar · Factura A 0003-00000094"). */
  subtitulo?: string;
  /** Chip corto y destacado (ej. "Venció hace 2 días", "Vence mañana"). */
  etiqueta?: string;
  /** Importe destacado a la derecha. Con `sentido`, suma al total "A cobrar"/"A pagar" del resumen (por moneda, nunca mezcladas). */
  importe?: { monto: number; moneda: string; sentido?: 'cobrar' | 'pagar' };
};

/** Un evaluator por tipo de notificación del catálogo — solo lee, nunca escribe (el cron decide envío + dedup). */
export interface NotificacionEvaluator {
  tipo: string;
  evaluar(tenantId: string): Promise<NotificacionItem[]>;
}
