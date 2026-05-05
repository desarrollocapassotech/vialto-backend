/**
 * Re-export de compatibilidad: la implementación vive en shared/util/factura-estado-lectura.
 * Los módulos externos (dashboard, platform) deben importar desde allí directamente.
 */
export { computeEstadoFacturaLectura, importeOperativoFactura } from '../../shared/util/factura-estado-lectura';

