/**
 * Re-export de compatibilidad: la implementación vive en shared/util/factura-estado-lectura.
 * Los módulos externos (dashboard, platform) deben importar desde allí directamente.
 */
export {
  cobroOptsDeFactura,
  computeEstadoFacturaLectura,
  FacturaTramoCobro,
  importeNetoFactura,
  importeOperativoFactura,
  ivaMontoDeTramos,
  restoSinTramoDeViaje,
  roundMoney2,
  viajeReemplazaMontoPorTramos,
} from '../../shared/util/factura-estado-lectura';

