import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AVISO_PRUEBA,
  agruparAlicuotas,
  comprobanteDeLog,
  datosComprobanteArca,
  documentoDesdeIdFiscal,
  enRango,
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
import { importeNetoFactura } from '../../shared/util/factura-estado-lectura';

/**
 * Libro IVA Ventas: facturas a clientes del período (por fecha del comprobante) + sus notas
 * de crédito de anulación (fecha de la nota). Ver `shared/util/libro-iva.util.ts`.
 * - Emitida en ARCA (producción): los montos salen del pedido que AFIP autorizó (`ArcaLog`,
 *   buscado por CAE). Si no hay log, se recalcula desde la factura y se avisa.
 * - Manual (con ARCA) o de empresa sin ARCA: tipo/punto de venta/número de los campos
 *   `manualCbte*` o, si no están, interpretando `numero`; montos desde la factura.
 * - Borradores sin emitir y comprobantes de homologación quedan afuera.
 */
export async function libroIvaVentas(
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
  const tieneArca = tenant?.modules.includes('emision-facturas-arca') ?? false;
  // El libro sigue el ambiente de la configuración ARCA: en homologación solo entran los
  // comprobantes de prueba; en producción, solo los reales. Los manuales (sin CAE), en los dos.
  const modoPrueba = tieneArca && (config?.ambiente ?? 'homologacion') === 'homologacion';

  // La fecha del comprobante ARCA puede correrse unos días de `fechaEmision` (ventana de AFIP):
  // se traen candidatos con margen y se filtra por la fecha real.
  const facturas = await prisma.factura.findMany({
    where: {
      tenantId,
      tipo: 'cliente',
      OR: [
        { fechaEmision: { gte: fechaConMargen(desde, -7), lte: fechaConMargen(hasta, 7) } },
        { anulacionFecha: { gte: fechaConMargen(desde, -2), lte: fechaConMargen(hasta, 2) } },
      ],
    },
    select: {
      id: true,
      numero: true,
      manual: true,
      manualCbteTipo: true,
      manualPtoVenta: true,
      manualCbteNro: true,
      cbteTipo: true,
      ptoVenta: true,
      cbteNro: true,
      cae: true,
      ambiente: true,
      arcaEstado: true,
      anuladoAt: true,
      fechaEmision: true,
      importe: true,
      ivaPct: true,
      ivaMonto: true,
      facturarPorTramo: true,
      moneda: true,
      anulacionCbteTipo: true,
      anulacionPtoVenta: true,
      anulacionCbteNro: true,
      anulacionCae: true,
      anulacionFecha: true,
      cliente: { select: { nombre: true, idFiscal: true } },
      viajes: {
        where: { tenantId },
        select: { id: true, monto: true, cantidadFactura: true, precioUnitarioFactura: true },
      },
      tramos: { where: { tenantId }, select: { viajeId: true, monto: true, ivaPct: true } },
    },
    orderBy: [{ fechaEmision: 'asc' }, { createdAt: 'asc' }],
  });

  const conCae = facturas.filter((f) => f.cae || f.anulacionCae).map((f) => f.id);
  const logs = conCae.length
    ? await prisma.arcaLog.findMany({
        where: {
          tenantId,
          facturaId: { in: conCae },
          method: { startsWith: 'FECAESolicitar' },
          exitoso: true,
        },
        select: { facturaId: true, requestBody: true, responseBody: true },
      })
    : [];
  const logsPorFactura = new Map<string, typeof logs>();
  for (const l of logs) {
    if (!l.facturaId) continue;
    logsPorFactura.set(l.facturaId, [...(logsPorFactura.get(l.facturaId) ?? []), l]);
  }

  const comprobantes: LibroIvaComprobante[] = [];
  for (const f of facturas) {
    const contraparte = f.cliente?.nombre ?? 'Sin cliente';
    const docCliente = documentoDesdeIdFiscal(f.cliente?.idFiscal);
    const montos = montosDesdeFactura(f);
    const emitidaEnArca = tieneArca && !f.manual && !!f.cae;

    if (emitidaEnArca) {
      const prueba = f.ambiente === 'homologacion';
      if (prueba !== modoPrueba) continue;
      const logsF = logsPorFactura.get(f.id) ?? [];
      const autorizado = comprobanteDeLog(logAutorizadoPorCae(logsF, f.cae));
      const base = datosComprobanteArca(autorizado, {
        cbteTipo: f.cbteTipo,
        ptoVenta: f.ptoVenta,
        cbteNro: f.cbteNro,
        fecha: ymdDeFecha(f.fechaEmision)!,
        doc: docCliente,
        montos,
        moneda: monedaAfip(f.moneda),
      });
      const fila: LibroIvaComprobante = {
        ...base,
        origenTipo: 'factura',
        origenId: f.id,
        contraparte,
        cae: f.cae,
        origen: 'arca',
        anulacion: false,
        prueba,
        comision: null,
        ivaComision: null,
        observaciones: prueba ? [AVISO_PRUEBA, ...base.observaciones] : base.observaciones,
        incompleto: null,
      };
      if (enRango(fila.fecha, desde, hasta)) comprobantes.push(fila);

      if (f.anulacionCae) {
        const autorizadoNc = comprobanteDeLog(logAutorizadoPorCae(logsF, f.anulacionCae));
        const nc = datosComprobanteArca(autorizadoNc, {
          cbteTipo: f.anulacionCbteTipo,
          ptoVenta: f.anulacionPtoVenta,
          cbteNro: f.anulacionCbteNro,
          fecha: ymdDeFecha(f.anulacionFecha) ?? fila.fecha,
          doc: docCliente,
          montos,
          moneda: monedaAfip(f.moneda),
        });
        const filaNc: LibroIvaComprobante = {
          ...nc,
          origenTipo: 'factura',
          origenId: f.id,
          contraparte,
          cae: f.anulacionCae,
          origen: 'arca',
          anulacion: true,
          prueba,
          comision: null,
          ivaComision: null,
          incompleto: null,
          observaciones: [
            ...(prueba ? [AVISO_PRUEBA] : []),
            ...nc.observaciones,
            `Anula la factura ${fila.numeroTexto}.`,
          ],
        };
        if (enRango(filaNc.fecha, desde, hasta)) comprobantes.push(filaNc);
      }
      continue;
    }

    // Con ARCA, una factura no manual sin CAE es un borrador (o un error): no se emitió.
    if (tieneArca && !f.manual) continue;

    const fecha = ymdDeFecha(f.fechaEmision)!;
    if (!enRango(fecha, desde, hasta)) continue;
    const partes =
      f.manualCbteTipo != null && f.manualPtoVenta != null && f.manualCbteNro != null
        ? { cbteTipo: f.manualCbteTipo, ptoVenta: f.manualPtoVenta, cbteNro: f.manualCbteNro }
        : parsearNumeroComprobante(f.numero);
    const observaciones: string[] = [];
    if (f.arcaEstado === 'anulado' || f.anuladoAt) {
      observaciones.push('Anulada en el sistema, sin nota de crédito registrada.');
    }
    const moneda = monedaAfip(f.moneda);
    comprobantes.push({
      origenTipo: 'factura',
      origenId: f.id,
      fecha,
      cbteTipo: partes?.cbteTipo ?? null,
      ptoVenta: partes?.ptoVenta ?? null,
      cbteNro: partes?.cbteNro ?? null,
      numeroTexto: f.numero ?? '',
      docTipo: docCliente.docTipo,
      docNro: docCliente.docNro,
      contraparte,
      alicuotas: montos.alicuotas,
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
      incompleto: partes
        ? null
        : 'El número no indica tipo (A/B/C) y punto de venta: corregilo en la factura.',
    });
  }

  comprobantes.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numeroTexto.localeCompare(b.numeroTexto));
  return {
    tipo: 'ventas',
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

type FacturaMontos = {
  importe: number;
  ivaPct: number | null;
  ivaMonto: number | null;
  facturarPorTramo: boolean;
  viajes: Array<{
    id: string;
    monto: number | null;
    cantidadFactura: number | null;
    precioUnitarioFactura: number | null;
  }>;
  tramos: Array<{ viajeId: string; monto: number; ivaPct: number }>;
};

/**
 * Neto e IVA por alícuota desde la factura (mismo criterio que el cobro): por tramo, cada
 * tramo con su IVA y los viajes sin tramo con el IVA de cabecera; si no, todo a la cabecera.
 */
function montosDesdeFactura(f: FacturaMontos): { alicuotas: LibroIvaAlicuota[]; total: number } {
  const ivaCabecera = f.ivaPct ?? 0;
  let items: Array<{ base: number; pct: number; iva?: number }>;
  if (f.facturarPorTramo && f.tramos.length > 0) {
    const conTramo = new Set(f.tramos.map((t) => t.viajeId));
    items = [
      ...f.tramos.map((t) => ({ base: t.monto, pct: t.ivaPct })),
      ...f.viajes
        .filter((v) => !conTramo.has(v.id))
        .map((v) => ({ base: importeNetoFactura(0, [v]), pct: ivaCabecera })),
    ];
  } else {
    const neto = importeNetoFactura(f.importe, f.viajes);
    items = [{ base: neto, pct: ivaCabecera, iva: f.ivaMonto ?? undefined }];
  }
  const alicuotas = agruparAlicuotas(items);
  const total = round2(alicuotas.reduce((s, a) => s + a.neto + a.iva, 0));
  return { alicuotas, total };
}

