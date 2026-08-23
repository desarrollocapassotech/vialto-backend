/** Un aviso candidato: una fila que va a un email agrupado por tipo de notificación. */
export type NotificacionItem = {
  /** id de la entidad que originó el aviso (ej. facturaId, cargaCombustibleId) — clave de dedup en `NotificacionEnvio`. */
  entidadId: string;
  titulo: string;
  detalle: string;
};

/** Un evaluator por tipo de notificación del catálogo — solo lee, nunca escribe (el cron decide envío + dedup). */
export interface NotificacionEvaluator {
  tipo: string;
  evaluar(tenantId: string): Promise<NotificacionItem[]>;
}
