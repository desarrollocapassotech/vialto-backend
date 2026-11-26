export type NotificacionFrecuencia = 'diaria' | 'semanal' | 'inmediata';

export type NotificacionCatalogoItem = {
  /** Slug único y estable — se persiste en `NotificacionConfig.tipo` y `NotificacionEnvio.tipo`. No renombrar sin migrar datos. */
  tipo: string;
  /** Agrupa el catálogo en la pantalla de configuración del tenant. */
  modulo: string;
  label: string;
  descripcion: string;
  /** Una línea debajo del título del email (corta, para quien lo recibe; `descripcion` es para la pantalla de config). */
  introEmail?: string;
  /** Default para un tenant sin override guardado. */
  defaultActivo: boolean;
  /**
   * Slug de `Tenant.modules` requerido para que esta notificación tenga sentido — si el tenant no lo tiene, ni
   * se evalúa ni se muestra en la config. Con una lista, alcanza con tener **alguno** (ver `tieneModuloRequerido`).
   */
  requiereModulo: string | string[];
  /**
   * Qué cron dispara este tipo — `diaria` la procesa `NotificacionesCronService.cronDiario`
   * (8 AM), `semanal` la procesa un cron específico de ese dominio en vez del diario (ej.
   * `combustible.cargaSospechosa` se dispara desde `CombustibleCorreccionCronService.cronSemanal`,
   * junto con la corrección de datos, para que el email refleje el resultado de esa corrida).
   * `inmediata` no tiene evaluator ni cron: la dispara el propio flujo de negocio en el
   * momento, vía `NotificacionesCronService.notificarAhora` (ej. `combustible.errorChofer`).
   */
  frecuencia: NotificacionFrecuencia;
  /**
   * Solo para `semanal`: true = lo dispara el cron de su propio módulo (sincronizado con otra
   * tarea, ej. la corrección de combustible) y no `NotificacionesCronService.cronSemanal`.
   */
  cronPropio?: boolean;
  /**
   * Ruta de la app (sin `#`, con query params) a la que apunta el botón principal del email — default: home.
   * Función si depende de los módulos del tenant. El `#` del HashRouter lo agrega `urlApp`.
   */
  urlDestino?: string | ((modules: string[]) => string);
  /**
   * Tabla de la entidad del aviso (id = `entidadId` hasta el primer ":"). Si la entidad se borra,
   * el aviso deja de mostrarse en la campana (`NotificacionesFeedService.purgarHuerfanas`).
   * Con una lista, el aviso se conserva mientras el id exista en alguna (ids cuid, únicos entre tablas).
   * Sin valor = el aviso no apunta a un registro estable y se conserva siempre.
   */
  entidadTabla?: string | string[];
};

export const NOTIFICACIONES_CATALOG: NotificacionCatalogoItem[] = [
  // Un solo aviso de vencimientos (nov 2026): antes había "Factura por vencer", "Factura vencida" y
  // "Vencimientos de cuenta corriente", y una empresa con los dos módulos recibía dos mails por la
  // misma factura (cada factura de cliente es también una venta en Cuenta corriente). Ver
  // `VencimientosEvaluator` y la migración `20261126120000_notificaciones_vencimientos_unificados`.
  {
    tipo: 'vencimientos',
    modulo: 'vencimientos',
    label: 'Vencimientos de cobros y pagos',
    descripcion:
      'Un solo aviso diario con lo que vence en los próximos 3 días y lo que ya venció sin cobrar o pagar: facturas de clientes y, con Cuenta corriente, también compras y liquidaciones a pagar. Cada vencimiento se avisa una vez al acercarse y otra vez si vence sin saldarse.',
    introEmail: 'Lo que vence en los próximos 3 días y lo que ya venció sin cobrar o pagar.',
    defaultActivo: true,
    requiereModulo: ['facturacion', 'cuenta-corriente'],
    frecuencia: 'diaria',
    urlDestino: (modules) => (modules.includes('cuenta-corriente') ? '/cuenta-corriente' : '/facturacion'),
    entidadTabla: ['movimientos_cuenta_corriente', 'facturas'],
  },
  {
    tipo: 'combustible.cargaSospechosa',
    modulo: 'combustible',
    label: 'Cargas de combustible para revisar',
    descripcion:
      'Resumen semanal de las cargas con algún dato que no cierra (litros, importe o kilometraje), según el control automático.',
    introEmail: 'Encontramos cargas con algún dato que no cierra. Fijate si están bien y corregilas si hace falta.',
    defaultActivo: true,
    requiereModulo: 'combustible',
    frecuencia: 'semanal',
    cronPropio: true,
    urlDestino: '/?combustibleTab=alertas',
    entidadTabla: 'cargas_combustible',
  },
  {
    tipo: 'combustible.errorChofer',
    modulo: 'combustible',
    label: 'Cargas de choferes que no se pudieron registrar',
    introEmail: 'La carga quedó trabada en el celular del chofer hasta que se corrija.',
    descripcion:
      'Avisa en el momento cuando la carga que un chofer guardó en el celular sin conexión es rechazada al sincronizar (km inconsistente, patente inexistente, etc.) y queda trabada hasta que se corrija.',
    defaultActivo: true,
    requiereModulo: 'combustible',
    frecuencia: 'inmediata',
    urlDestino: '/?combustibleTab=alertas',
  },
  {
    tipo: 'liquidaciones.pendienteAnulacion',
    modulo: 'liquidaciones',
    label: 'Liquidaciones pendientes de anular',
    introEmail: 'Recordatorio semanal: estas liquidaciones siguen esperando que se confirme su anulación.',
    descripcion:
      'Recordatorio semanal (lunes) de las liquidaciones marcadas como pendientes de anulación que todavía no se confirmaron como anuladas. Se repite cada semana mientras sigan pendientes.',
    defaultActivo: true,
    requiereModulo: 'emision-liquido-producto-arca',
    frecuencia: 'semanal',
    urlDestino: '/liquidaciones?estado=pendiente_anulacion',
    entidadTabla: 'liquidaciones',
  },
  // Mantenimiento: los evaluators viven en modules/mantenimiento y se registran con
  // NotificacionesCronService.registrarEvaluator (reusan el cálculo de vencimientos).
  {
    tipo: 'mantenimiento.vencimientoProximo',
    modulo: 'mantenimiento',
    label: 'Mantenimiento próximo a vencer',
    descripcion:
      'Avisa una vez por ciclo cuando un plan de mantenimiento de un vehículo entra en el período de aviso (por km o por fecha).',
    defaultActivo: true,
    requiereModulo: 'mantenimiento',
    frecuencia: 'diaria',
    urlDestino: '/mantenimiento',
    entidadTabla: 'vehiculos_planes',
  },
  {
    tipo: 'mantenimiento.vencido',
    modulo: 'mantenimiento',
    label: 'Mantenimiento vencido',
    descripcion:
      'Avisa una vez por ciclo cuando un plan de mantenimiento de un vehículo venció (por km o por fecha).',
    defaultActivo: true,
    requiereModulo: 'mantenimiento',
    frecuencia: 'diaria',
    urlDestino: '/mantenimiento',
    entidadTabla: 'vehiculos_planes',
  },
];

/** El tenant tiene el módulo que pide el tipo (o alguno, si pide una lista). */
export function tieneModuloRequerido(item: NotificacionCatalogoItem, modules: string[]): boolean {
  const requeridos = Array.isArray(item.requiereModulo) ? item.requiereModulo : [item.requiereModulo];
  return requeridos.some((m) => modules.includes(m));
}

/** Ruta del botón principal del email para este tenant (sin `#`). */
export function urlDestinoDe(item: NotificacionCatalogoItem, modules: string[]): string {
  const u = item.urlDestino;
  return (typeof u === 'function' ? u(modules) : u) ?? '/';
}

export function getNotificacionesCatalogoPorModulos(
  modules: string[],
  frecuencia?: NotificacionFrecuencia,
): NotificacionCatalogoItem[] {
  return NOTIFICACIONES_CATALOG.filter(
    (item) =>
      tieneModuloRequerido(item, modules) &&
      (frecuencia === undefined || item.frecuencia === frecuencia),
  );
}
