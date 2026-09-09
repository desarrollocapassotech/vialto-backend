export type NotificacionFrecuencia = 'diaria' | 'semanal';

export type NotificacionCatalogoItem = {
  /** Slug único y estable — se persiste en `NotificacionConfig.tipo` y `NotificacionEnvio.tipo`. No renombrar sin migrar datos. */
  tipo: string;
  /** Agrupa el catálogo en la pantalla de configuración del tenant. */
  modulo: string;
  label: string;
  descripcion: string;
  /** Default para un tenant sin override guardado. */
  defaultActivo: boolean;
  /** Slug de `Tenant.modules` requerido para que esta notificación tenga sentido — si el tenant no lo tiene, ni se evalúa ni se muestra en la config. */
  requiereModulo: string;
  /**
   * Qué cron dispara este tipo — `diaria` la procesa `NotificacionesCronService.cronDiario`
   * (8 AM), `semanal` la procesa un cron específico de ese dominio en vez del diario (ej.
   * `combustible.cargaSospechosa` se dispara desde `CombustibleCorreccionCronService.cronSemanal`,
   * junto con la corrección de datos, para que el email refleje el resultado de esa corrida).
   */
  frecuencia: NotificacionFrecuencia;
  /** Ruta relativa (con query params) a la que apunta el botón del email — default: home. */
  urlDestino?: string;
};

export const NOTIFICACIONES_CATALOG: NotificacionCatalogoItem[] = [
  {
    tipo: 'facturacion.facturaPorVencer',
    modulo: 'facturacion',
    label: 'Factura de cliente por vencer',
    descripcion:
      'Avisa cuando una factura de cliente vence en los próximos días y todavía no fue cobrada.',
    defaultActivo: true,
    requiereModulo: 'facturacion',
    frecuencia: 'diaria',
  },
  {
    tipo: 'combustible.cargaSospechosa',
    modulo: 'combustible',
    label: 'Cargas de combustible sospechosas',
    descripcion:
      'Resumen semanal de cargas con litros, importe o kilometraje fuera de rango, detectadas por la corrección automática.',
    defaultActivo: true,
    requiereModulo: 'combustible',
    frecuencia: 'semanal',
    urlDestino: '/?combustibleTab=alertas',
  },
];

export function getNotificacionesCatalogoPorModulos(
  modules: string[],
  frecuencia?: NotificacionFrecuencia,
): NotificacionCatalogoItem[] {
  return NOTIFICACIONES_CATALOG.filter(
    (item) =>
      modules.includes(item.requiereModulo) &&
      (frecuencia === undefined || item.frecuencia === frecuencia),
  );
}
