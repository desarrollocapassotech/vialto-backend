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
  },
  {
    tipo: 'combustible.cargaSospechosa',
    modulo: 'combustible',
    label: 'Carga de combustible sospechosa',
    descripcion:
      'Avisa cuando el sistema detecta una carga con litros, importe o kilometraje fuera de rango.',
    defaultActivo: true,
    requiereModulo: 'combustible',
  },
];

export function getNotificacionesCatalogoPorModulos(
  modules: string[],
): NotificacionCatalogoItem[] {
  return NOTIFICACIONES_CATALOG.filter((item) => modules.includes(item.requiereModulo));
}
