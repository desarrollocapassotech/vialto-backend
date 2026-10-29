import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AVISO_PRUEBA,
  comprobanteDeLog,
  datosComprobanteArca,
  documentoDesdeIdFiscal,
  enRango,
  esClaseBoC,
  fechaConMargen,
  logAutorizadoPorCae,
  monedaAfip,
  round2,
  ymdDeFecha,
  type LibroIvaAlicuota,
  type LibroIvaComprobante,
  type LibroIvaResultado,
} from '../../shared/util/libro-iva.util';
import { parsearNumeroComprobante } from '../../shared/util/comprobante-manual.util';

/**
 * Libro IVA Compras: liquidaciones del período. Ver `shared/util/libro-iva.util.ts`.
 * - CVLP (060) emitido en ARCA (producción): completo, con los montos que autorizó AFIP
 *   (`ArcaLog` por CAE), la comisión y su IVA. Su NC/ND de anulación va aparte, por la fecha
 *   de la nota. Una anulación manual (comprobante pre-impreso) no se incluye: queda el aviso.
 * - Liquidación manual (monotributista) o de empresa sin ARCA: la factura del transportista
 *   (`proveedorCbte*`, o interpretando `numeroComprobanteProveedor`), por la fecha de esa factura.
 * - Liquidaciones con ARCA sin emitir y comprobantes de homologación quedan afuera.
 */
export async function libroIvaCompras(
  prisma: PrismaService,
  tenantId: string,
  desde: string,
  hasta: string,
): Promise<LibroIvaResultado> {
  const [tenant, config] = await Promise.all([
    prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true, idFiscal: true, name: true },
    }),
    prisma.arcaConfig.findUnique({
      where: { tenantId },
      select: { cuitEmisor: true, razonSocial: true, ambiente: true },
    }),
  ]);
  const tieneArca = tenant?.modules.includes('emision-liquido-producto-arca') ?? false;
  // El libro sigue el ambiente de la configuración ARCA: en homologación solo entran los
  // comprobantes de prueba; en producción, solo los reales. Los manuales (sin CAE), en los dos.
  const modoPrueba = tieneArca && (config?.ambiente ?? 'homologacion') === 'homologacion';

  // La liquidación no guarda la fecha del CVLP (vive en el log): se traen candidatas con
  // margen y se filtra por la fecha real de cada comprobante.
  const liquidaciones = await prisma.liquidacion.findMany({
    where: {
      tenantId,
      OR: [
        { createdAt: { gte: fechaConMargen(desde, -120), lte: fechaConMargen(hasta, 7) } },
        { anulacionFecha: { gte: fechaConMargen(desde, -2), lte: fechaConMargen(hasta, 2) } },
        { proveedorCbteFecha: { gte: fechaConMargen(desde, 0), lte: fechaConMargen(hasta, 0) } },
      ],
    },
    select: {
      id: true,
      moneda: true,
      estado: true,
      manual: true,
      cbteTipo: true,
      ptoVenta: true,
      cbteNro: true,
      cae: true,
      ambiente: true,
      comision: true,
      ivaPct: true,
      liquido: true,
      gastosAdminIva: true,
      anulacionCbteTipo: true,
      anulacionPtoVenta: true,
      anulacionCbteNro: true,
      anulacionCae: true,
      anulacionFecha: true,
      anulacionMetodo: true,
      numeroComprobanteProveedor: true,
      proveedorCbteTipo: true,
      proveedorPtoVenta: true,
      proveedorCbteNro: true,
      proveedorCbteFecha: true,
      createdAt: true,
      updatedAt: true,
      transportista: { select: { nombre: true, idFiscal: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const conCae = liquidaciones.filter((l) => l.cae || l.anulacionCae).map((l) => l.id);
  const logs = conCae.length
    ? await prisma.arcaLog.findMany({
        where: {
          tenantId,
          liquidacionId: { in: conCae },
          method: { startsWith: 'FECAESolicitar' },
          exitoso: true,
        },
        select: { liquidacionId: true, requestBody: true, responseBody: true },
      })
    : [];
  const logsPorLiq = new Map<string, typeof logs>();
  for (const l of logs) {
    if (!l.liquidacionId) continue;
    logsPorLiq.set(l.liquidacionId, [...(logsPorLiq.get(l.liquidacionId) ?? []), l]);
  }

  const comprobantes: LibroIvaComprobante[] = [];
  for (const l of liquidaciones) {
    const contraparte = l.transportista?.nombre ?? 'Sin transportista';
    const docTransportista = documentoDesdeIdFiscal(l.transportista?.idFiscal);
    const moneda = monedaAfip(l.moneda);
    const montos = montosDesdeLiquidacion(l);

    if (l.cae && !l.manual) {
      const prueba = l.ambiente === 'homologacion';
      if (prueba !== modoPrueba) continue;
      const logsL = logsPorLiq.get(l.id) ?? [];
      const datos = datosComprobanteArca(comprobanteDeLog(logAutorizadoPorCae(logsL, l.cae)), {
        cbteTipo: l.cbteTipo,
        ptoVenta: l.ptoVenta,
        cbteNro: l.cbteNro,
        fecha: ymdDeFecha(l.updatedAt)!,
        doc: docTransportista,
        montos,
        moneda,
      });
      const observaciones = [...(prueba ? [AVISO_PRUEBA] : []), ...datos.observaciones];
      if (l.estado === 'anulado' && l.anulacionMetodo === 'manual') {
        observaciones.push(
          'Anulada manualmente con comprobante pre-impreso: la anulación no está en el sistema y no se incluye.',
        );
      } else if (l.estado === 'pendiente_anulacion') {
        observaciones.push('Pendiente de anulación manual.');
      }
      const fila: LibroIvaComprobante = {
        ...datos,
        origenTipo: 'liquidacion',
        origenId: l.id,
        contraparte,
        cae: l.cae,
        origen: 'arca',
        anulacion: false,
        prueba,
        comision: l.comision,
        ivaComision: round2((l.comision * (l.ivaPct ?? 0)) / 100),
        observaciones,
        incompleto: null,
      };
      if (enRango(fila.fecha, desde, hasta)) comprobantes.push(fila);

      if (l.anulacionCae) {
        const nc = datosComprobanteArca(
          comprobanteDeLog(logAutorizadoPorCae(logsL, l.anulacionCae)),
          {
            cbteTipo: l.anulacionCbteTipo,
            ptoVenta: l.anulacionPtoVenta,
            cbteNro: l.anulacionCbteNro,
            fecha: ymdDeFecha(l.anulacionFecha) ?? fila.fecha,
            doc: docTransportista,
            montos,
            moneda,
          },
        );
        const filaNc: LibroIvaComprobante = {
          ...nc,
          origenTipo: 'liquidacion',
          origenId: l.id,
          contraparte,
          cae: l.anulacionCae,
          origen: 'arca',
          anulacion: true,
          prueba,
          comision: null,
          ivaComision: null,
          observaciones: [
            ...(prueba ? [AVISO_PRUEBA] : []),
            ...nc.observaciones,
            `Anula el Líquido Producto ${fila.numeroTexto}.`,
          ],
          incompleto: null,
        };
        if (enRango(filaNc.fecha, desde, hasta)) comprobantes.push(filaNc);
      }
      continue;
    }

    // Con ARCA, una liquidación no manual sin CAE no se emitió (borrador / error).
    if (tieneArca && !l.manual) continue;

    const partes =
      l.proveedorCbteTipo != null && l.proveedorPtoVenta != null && l.proveedorCbteNro != null
        ? { cbteTipo: l.proveedorCbteTipo, ptoVenta: l.proveedorPtoVenta, cbteNro: l.proveedorCbteNro }
        : parsearNumeroComprobante(l.numeroComprobanteProveedor);
    const fechaFactura = ymdDeFecha(l.proveedorCbteFecha);
    const fecha = fechaFactura ?? ymdDeFecha(l.createdAt)!;
    if (!enRango(fecha, desde, hasta)) continue;
    const observaciones: string[] = [];
    if (!fechaFactura) observaciones.push('Sin fecha de la factura: se usa la fecha de carga de la liquidación.');
    if (l.estado === 'anulado') observaciones.push('Liquidación anulada en el sistema.');
    const sinIva = esClaseBoC(partes?.cbteTipo ?? null);
    comprobantes.push({
      origenTipo: 'liquidacion',
      origenId: l.id,
      fecha,
      cbteTipo: partes?.cbteTipo ?? null,
      ptoVenta: partes?.ptoVenta ?? null,
      cbteNro: partes?.cbteNro ?? null,
      numeroTexto: l.numeroComprobanteProveedor ?? '',
      docTipo: docTransportista.docTipo,
      docNro: docTransportista.docNro,
      contraparte,
      // B o C no discriminan IVA: solo el total.
      alicuotas: sinIva ? [] : montos.alicuotas,
      noGravado: 0,
      exento: 0,
      otrosTributos: 0,
      total: montos.total,
      moneda,
      cotizacion: moneda === 'PES' ? 1 : null,
      cae: null,
      origen: 'manual',
      anulacion: false,
      prueba: false,
      comision: null,
      ivaComision: null,
      observaciones,
      incompleto: !partes
        ? 'El número de la factura del transportista no indica tipo (A/B/C) y punto de venta.'
        : !fechaFactura
          ? 'Falta la fecha de la factura del transportista.'
          : null,
    });
  }

  comprobantes.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numeroTexto.localeCompare(b.numeroTexto));
  return {
    tipo: 'compras',
    desde,
    hasta,
    esPrueba: modoPrueba,
    informante: {
      cuit: config?.cuitEmisor ?? tenant?.idFiscal ?? null,
      razonSocial: config?.razonSocial ?? tenant?.name ?? null,
    },
    comprobantes,
  };
}

/** Respaldo sin log: líquido = neto + IVA, todo a la alícuota de la liquidación. */
function montosDesdeLiquidacion(l: {
  liquido: number;
  gastosAdminIva: number;
  ivaPct: number | null;
}): { alicuotas: LibroIvaAlicuota[]; total: number } {
  const iva = round2(l.gastosAdminIva);
  const total = round2(l.liquido);
  return { alicuotas: [{ pct: l.ivaPct ?? 0, neto: round2(total - iva), iva }], total };
}
