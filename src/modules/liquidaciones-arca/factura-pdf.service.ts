import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArcaConfigService } from './arca-config.service';
import { buildComprobanteCvlp } from './arca-cvlp.util';
import { cvlpPdfPieFinanciero, resolveIvaPct, round2 } from './arca-iva.util';
import {
  buildFacturaConceptosList,
  defaultFacturaLineas,
} from './factura-conceptos.util';
import {
  drawHomologacionWatermark,
  shouldShowHomologacionWatermark,
} from './pdf-homologacion-watermark';
import { pdfColoresComprobante } from './pdf-color-comprobante';
import { ArcaComprobanteCvlp } from './types/arca.types';
import { numeroVisibleViaje } from '../viajes/viaje-numero-visible.util';
import { normalizeUnidadCantidad } from './cantidad-unidad.util';
import { productoLabels } from '../../shared/util/producto-label.util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

const CONDICION_IVA_LABEL: Record<number, string> = {
  1: 'RESP. INSCRIPTO',
  4: 'IVA SUJETO EXENTO',
  5: 'CONSUMIDOR FINAL',
  6: 'RESP. MONOTRIBUTO',
};

const LETRA_POR_TIPO: Record<number, string> = {
  1: 'A',
  3: 'A', // Nota de Crédito A
  6: 'B',
  8: 'B', // Nota de Crédito B
  11: 'C',
};

const TITULO_POR_TIPO: Record<number, string> = {
  1: 'FACTURA',
  3: 'NOTA DE CREDITO',
  6: 'FACTURA',
  8: 'NOTA DE CREDITO',
  11: 'FACTURA',
};

function fmtNum(n: number, decimals = 2): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

type ViajeParaDetalle = {
  numero: string;
  numeroIdentificacionPersonalizado: string | null;
  idPropio2: string | null;
  origen?: string | null;
  destino?: string | null;
  productosViaje?: Array<{ producto: { nombre: string } }>;
};

type TenantPdfConfig = {
  idPropio2Habilitado: boolean;
  idPropio2Label: string | null;
  unidadCantidadViajes: string;
  labelIdentificacionPersonalizadaViajes: string | null;
  productoLabel: string | null;
  productoLabelPlural: string | null;
} | null;

/**
 * Matchea un ítem del comprobante (solo tiene `producto`/`descripcion`, sin viajeId)
 * contra `factura.viajes` reconstruyendo el mismo texto que arma `item.producto`
 * (numeroIdentificacionPersonalizado o `#numero`).
 */
function matchViajeItem(
  item: { producto?: string },
  viajes: ViajeParaDetalle[],
): ViajeParaDetalle | undefined {
  if (!item.producto) return undefined;
  return viajes.find(
    (v) => (v.numeroIdentificacionPersonalizado?.trim() || `#${v.numero}`) === item.producto,
  );
}

/**
 * Arma el texto de la columna "Detalle": "FLETE S/[LABEL ID PROPIO 1]: [CTG] – [LABEL
 * ID PROPIO 2] [VALOR] – ORIGEN: [ORIGEN] DESTINO: [DESTINO] - PRODUCTO: [PRODUCTO]".
 * El label del primer segmento es `Tenant.labelIdentificacionPersonalizadaViajes`
 * ("ID propio" por defecto; ej. "CTG" para NyM) si el viaje tiene ID propio cargado, o
 * "VIAJE" + número interno si no — siempre se muestra (no depende de
 * ningún módulo), a diferencia del segmento de ID Propio 2 (label = `idPropio2Label`)
 * y el de PRODUCTO, que son opcionales. Puramente a nivel de dibujo del PDF (no se
 * persiste, no es texto fiscal: ArcaComprobanteItem es solo presentación/auditoría,
 * WSFEv1 no recibe detalle de líneas). Si el ítem no matchea contra ningún viaje (ej.
 * la línea genérica "Servicios de transporte" de una factura sin viajes vinculados),
 * se deja la descripción original
 * tal cual.
 */
function buildDetalleFlete(
  item: { descripcion: string; producto?: string },
  viajes: ViajeParaDetalle[],
  tenantPdfConfig: TenantPdfConfig,
): string {
  const viaje = matchViajeItem(item, viajes);
  if (!viaje) return item.descripcion;

  const ctg = numeroVisibleViaje(viaje);
  // El nombre del ID propio solo va si el viaje lo tiene cargado; si no, `ctg` es el
  // número interno (#123) y rotularlo "CTG" sería incorrecto.
  const labelCtg = viaje.numeroIdentificacionPersonalizado?.trim()
    ? tenantPdfConfig?.labelIdentificacionPersonalizadaViajes?.trim() || 'ID propio'
    : 'VIAJE';
  const idPropio2Valor = viaje.idPropio2?.trim();
  const usaIdPropio2 = Boolean(tenantPdfConfig?.idPropio2Habilitado && idPropio2Valor);
  const label = tenantPdfConfig?.idPropio2Label?.trim() || 'ID Propio 2';

  const producto = (viaje.productosViaje ?? [])
    .map((p) => p.producto?.nombre)
    .filter(Boolean)
    .join(', ');

  const partes: string[] = [`FLETE S/${labelCtg}: ${ctg}`];
  if (usaIdPropio2) partes.push(`${label} ${idPropio2Valor}`);

  const rutaPartes: string[] = [];
  if (viaje.origen) rutaPartes.push(`ORIGEN: ${viaje.origen}`);
  if (viaje.destino) rutaPartes.push(`DESTINO: ${viaje.destino}`);
  if (rutaPartes.length) partes.push(rutaPartes.join(' '));

  let detalle = partes.join(' – ');
  if (producto) {
    detalle += ` - ${productoLabels(tenantPdfConfig).singular.toUpperCase()}: ${producto}`;
  }
  return detalle;
}

const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const VEINTES = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function dosDigitos(n: number): string {
  if (n === 0) return '';
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 2) return VEINTES[u];
  if (u === 0) return DECENAS[d];
  return `${DECENAS[d]} Y ${UNIDADES[u]}`;
}

function tresDigitos(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const centStr = c > 0 ? CENTENAS[c] : '';
  return [centStr, dosDigitos(resto)].filter(Boolean).join(' ');
}

function numeroALetras(n: number): string {
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const centavosStr = centavos === 0 ? 'CERO' : dosDigitos(centavos);
  if (entero === 0) return `CERO CON ${centavosStr} CENTAVO(S)`;
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;
  const partes: string[] = [];
  if (millones > 0) partes.push(`${tresDigitos(millones)} ${millones === 1 ? 'MILLÓN' : 'MILLONES'}`);
  if (miles > 0) partes.push(`${miles === 1 ? 'MIL' : `${tresDigitos(miles)} MIL`}`);
  if (resto > 0) partes.push(tresDigitos(resto));
  return `${partes.join(' ')} CON ${centavosStr} CENTAVO(S)`;
}

function slugify(text: string): string {
  const withoutDiacritics = text
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
  const clean = withoutDiacritics
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean.slice(0, 60) || 'factura';
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const COL_W = PAGE_W - MARGIN * 2;

@Injectable()
export class FacturaPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arcaConfig: ArcaConfigService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  async generate(
    tenantId: string,
    facturaId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.generateInternal(tenantId, facturaId, 'factura');
  }

  /** PDF de la Nota de Crédito A/B que anula la factura, con comprobante asociado. */
  async generateNotaCredito(
    tenantId: string,
    facturaId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.generateInternal(tenantId, facturaId, 'nc');
  }

  private async generateInternal(
    tenantId: string,
    facturaId: string,
    kind: 'factura' | 'nc',
  ): Promise<{ buffer: Buffer; filename: string }> {
    const factura = await this.prisma.factura.findUnique({
      where: { id: facturaId },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            direccion: true,
            condicionIva: true,
            condicionPagoDias: true,
          },
        },
        viajes: {
          select: {
            numero: true,
            numeroIdentificacionPersonalizado: true,
            idPropio2: true,
            monto: true,
            cantidadFactura: true,
            precioUnitarioFactura: true,
            origen: true,
            destino: true,
            fechaCarga: true,
            productosViaje: {
              select: { producto: { select: { nombre: true } } },
            },
          },
        },
      },
    });

    if (!factura || factura.tenantId !== tenantId) {
      throw new NotFoundException('Factura no encontrada');
    }

    const tenantPdfConfig = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: {
        idPropio2Habilitado: true,
        idPropio2Label: true,
        unidadCantidadViajes: true,
        labelIdentificacionPersonalizadaViajes: true,
        productoLabel: true,
        productoLabelPlural: true,
      },
    });

    const facturaExt = factura as typeof factura & {
      cbteTipo?: number | null;
      cbteNro?: number | null;
      ptoVenta?: number | null;
      cae?: string | null;
      caeFechaVto?: Date | null;
      anulacionCbteTipo?: number | null;
      anulacionCbteNro?: number | null;
      anulacionPtoVenta?: number | null;
      anulacionCae?: string | null;
      anulacionCaeFechaVto?: Date | null;
      anulacionFecha?: Date | null;
      arcaEstado?: string | null;
    };

    if (kind === 'nc') {
      if (
        facturaExt.arcaEstado !== 'anulado' ||
        !facturaExt.anulacionCae ||
        !facturaExt.anulacionCbteNro
      ) {
        throw new BadRequestException(
          'No hay Nota de Crédito de anulación para esta factura.',
        );
      }
    }

      const drawCbteTipo =
      kind === 'nc'
        ? (facturaExt.anulacionCbteTipo ?? 3)
        : (facturaExt.cbteTipo ?? 6);
    const drawCbteNro =
      kind === 'nc' ? facturaExt.anulacionCbteNro : facturaExt.cbteNro;
    const drawPtoVenta =
      kind === 'nc'
        ? (facturaExt.anulacionPtoVenta ?? facturaExt.ptoVenta)
        : facturaExt.ptoVenta;
    const drawCae =
      kind === 'nc' ? facturaExt.anulacionCae : facturaExt.cae;
    const drawCaeVto =
      kind === 'nc'
        ? facturaExt.anulacionCaeFechaVto
        : facturaExt.caeFechaVto;
    const drawFecha =
      kind === 'nc'
        ? (facturaExt.anulacionFecha ?? factura.fechaEmision)
        : factura.fechaEmision;

    const drawExt = {
      ...facturaExt,
      cbteTipo: drawCbteTipo,
      cbteNro: drawCbteNro,
      ptoVenta: drawPtoVenta,
      cae: drawCae,
      caeFechaVto: drawCaeVto,
    };

    const asociados =
      kind === 'nc' &&
      facturaExt.cbteNro != null &&
      facturaExt.ptoVenta != null &&
      facturaExt.cbteTipo != null
        ? [
            {
              tipo: facturaExt.cbteTipo,
              ptoVenta: facturaExt.ptoVenta,
              nro: facturaExt.cbteNro,
            },
          ]
        : [];

    const config = await this.arcaConfig.findParaComprobante(tenantId);

    let qrBuffer: Buffer | null = null;
    if (drawCae && drawCbteNro && drawPtoVenta) {
      const docNroRec = factura.cliente?.idFiscal
        ? Number(String(factura.cliente.idFiscal).replace(/-/g, ''))
        : 0;
      const impTotal = await this.resolveImpTotal(facturaId, factura, config);
      const payload = {
        ver: 1,
        fecha: drawFecha.toISOString().slice(0, 10),
        cuit: Number(String(config?.cuitEmisor ?? '0').replace(/-/g, '')),
        ptoVta: drawPtoVenta,
        tipoCmp: drawCbteTipo,
        nroCmp: drawCbteNro,
        importe: Math.round(impTotal * 100) / 100,
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: docNroRec ? 80 : 99,
        nroDocRec: docNroRec,
        tipoCodAut: 'E',
        codAut: Number(drawCae),
      };
      const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
      qrBuffer = (await QRCode.toBuffer(qrUrl, {
        width: 72,
        margin: 1,
      })) as Buffer;
    }

    let logoBuffer: Buffer | null = null;
    if (config?.logoUrl) {
      try {
        const fetched = await fetch(config.logoUrl);
        if (fetched.ok) logoBuffer = Buffer.from(await fetched.arrayBuffer());
      } catch {
        // PDF sin logo si falla la descarga
      }
    }

    const comprobante = await this.resolveComprobanteForKind(
      factura,
      config,
      kind,
      drawExt,
    );
    const buffer = await this.buildPdf(
      { ...factura, fechaEmision: drawFecha },
      drawExt,
      config,
      qrBuffer,
      logoBuffer,
      comprobante,
      asociados,
      kind,
      tenantPdfConfig,
    );

    const cbteNroStr =
      drawCbteNro && drawPtoVenta
        ? `${String(drawPtoVenta).padStart(4, '0')}-${String(drawCbteNro).padStart(8, '0')}`
        : factura.numero.slice(0, 20);
    const clienteSlug = slugify(factura.cliente?.nombre ?? 'cliente');
    const letra = LETRA_POR_TIPO[drawCbteTipo] ?? 'B';
    const prefix = kind === 'nc' ? 'NC' : 'Factura';
    const filename = `${prefix}_${letra}_${cbteNroStr}_${clienteSlug}.pdf`;

    return { buffer, filename };
  }

  private async resolveImpTotal(
    facturaId: string,
    factura: PrismaAny,
    config: PrismaAny,
  ): Promise<number> {
    const comprobante = await this.resolveComprobante(factura, config);
    return comprobante.impTotal;
  }

  private async resolveComprobanteForKind(
    factura: PrismaAny,
    config: PrismaAny,
    kind: 'factura' | 'nc',
    drawExt: PrismaAny,
  ): Promise<ArcaComprobanteCvlp> {
    if (kind === 'nc') {
      // Preferir metadata del log de la NC; si no, reconstruir con datos de anulación.
      const log = await this.db.arcaLog.findFirst({
        where: { facturaId: factura.id, exitoso: true, method: 'FECAESolicitar' },
        orderBy: { createdAt: 'desc' },
      });
      const metadata = (log?.requestBody as { auditMetadata?: ArcaComprobanteCvlp })
        ?.auditMetadata;
      if (
        metadata &&
        Array.isArray(metadata.items) &&
        metadata.cbteTipo === drawExt.cbteTipo
      ) {
        this.retrofitMetadataItems(metadata, factura.viajes);
        return metadata;
      }
      const ivaPct = resolveIvaPct(factura.ivaPct ?? config?.ivaGastosAdmin);
      const lineas = defaultFacturaLineas(factura, factura.viajes ?? []);
      const conceptos = buildFacturaConceptosList(lineas, ivaPct);
      const docNro = factura.cliente?.idFiscal
        ? Number(String(factura.cliente.idFiscal).replace(/-/g, ''))
        : 0;
      return buildComprobanteCvlp(
        {
          cuit: config?.cuitEmisor ?? '',
          ptoVenta: drawExt.ptoVenta ?? 0,
          cbteTipo: drawExt.cbteTipo ?? 3,
          cbteNro: drawExt.cbteNro ?? 0,
          fechaCbte: (factura.fechaEmision as Date)
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, ''),
          concepto: 1,
          docTipo: docNro ? 80 : 99,
          docNro,
          condicionIvaReceptorId: factura.cliente?.condicionIva ?? 5,
        },
        conceptos,
        ivaPct,
      );
    }
    return this.resolveComprobante(factura, config);
  }
  private retrofitMetadataItems(metadata: ArcaComprobanteCvlp, viajes: any[]) {
    if (!viajes || !Array.isArray(viajes)) return;
    for (const item of metadata.items) {
      if (item.producto) continue; // Ya tiene el formato nuevo
      
      const match = item.descripcion.match(/Viaje #([a-zA-Z0-9_-]+)/i);
      if (match) {
        const numero = match[1];
        const viaje = viajes.find((v) => v.numero === numero);
        if (viaje) {
          item.producto = viaje.numeroIdentificacionPersonalizado || `#${viaje.numero}`;
          
          const ruta = [viaje.origen, viaje.destino].filter(Boolean).join(' — ');
          const fechaTxt = viaje.fechaCarga 
            ? new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' }).format(viaje.fechaCarga) 
            : '';
          const partesDesc = [ruta, fechaTxt].filter(Boolean).join(' - ');
          item.descripcion = partesDesc || item.descripcion;
          
          if (item.cantidad == null && viaje.cantidadFactura != null) {
            item.cantidad = viaje.cantidadFactura;
          }
          if (item.precioUnitario == null && viaje.precioUnitarioFactura != null) {
            item.precioUnitario = viaje.precioUnitarioFactura;
          }
          // Cantidad × precio tienen que cuadrar con el neto ya autorizado.
          // Si el viaje quedó desfasado respecto de la línea, no mostremos un
          // unitario que al multiplicar dé otro IVA (calculadora vs pie).
          if (
            item.cantidad != null &&
            item.precioUnitario != null &&
            round2(item.cantidad * item.precioUnitario) !== round2(item.importeBase)
          ) {
            item.precioUnitario =
              item.cantidad !== 0
                ? round2(item.importeBase / item.cantidad)
                : item.precioUnitario;
          }
        }
      }
    }
  }

  private async resolveComprobante(
    factura: PrismaAny,
    config: PrismaAny,
  ): Promise<ArcaComprobanteCvlp> {
    if (factura.cae) {
      const log = await this.db.arcaLog.findFirst({
        where: { facturaId: factura.id, exitoso: true, method: 'FECAESolicitar' },
        orderBy: { createdAt: 'desc' },
      });
      const metadata = (log?.requestBody as { auditMetadata?: ArcaComprobanteCvlp })
        ?.auditMetadata;
      if (metadata && Array.isArray(metadata.items)) {
        this.retrofitMetadataItems(metadata, factura.viajes);
        return metadata;
      }
    }

    const ivaPct = resolveIvaPct(factura.ivaPct ?? config?.ivaGastosAdmin);
    const lineas = defaultFacturaLineas(factura, factura.viajes ?? []);
    const conceptos = buildFacturaConceptosList(lineas, ivaPct);
    const docNro = factura.cliente?.idFiscal
      ? Number(String(factura.cliente.idFiscal).replace(/-/g, ''))
      : 0;

    const cabeceraBase = {
      cuit: config?.cuitEmisor ?? '',
      ptoVenta: factura.ptoVenta ?? config?.ptoVentaFactura ?? 0,
      cbteTipo: factura.cbteTipo ?? 6,
      cbteNro: factura.cbteNro ?? 0,
      fechaCbte: factura.fechaEmision
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, ''),
      concepto: 1,
      docTipo: docNro ? 80 : 99,
      docNro,
      condicionIvaReceptorId: factura.cliente?.condicionIva ?? 5,
    };

    return buildComprobanteCvlp(cabeceraBase, conceptos, ivaPct);
  }

  private buildPdf(
    factura: PrismaAny,
    facturaExt: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    logoBuffer: Buffer | null,
    comprobante: ArcaComprobanteCvlp,
    asociados: Array<{ tipo: number; ptoVenta: number; nro: number }> = [],
    kind: 'factura' | 'nc' = 'factura',
    tenantPdfConfig: TenantPdfConfig = null,
  ): Promise<Buffer> {
    // Ambiente desde ArcaConfig del tenant (misma condición que PDF CVLP).
    const showTestWatermark = shouldShowHomologacionWatermark(config?.ambiente);
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.draw(
          doc,
          factura,
          facturaExt,
          config,
          qrBuffer,
          logoBuffer,
          'ORIGINAL',
          comprobante,
          asociados,
          showTestWatermark,
          kind,
          tenantPdfConfig,
        );
        doc.addPage();
        this.draw(
          doc,
          factura,
          facturaExt,
          config,
          qrBuffer,
          logoBuffer,
          'DUPLICADO',
          comprobante,
          asociados,
          showTestWatermark,
          kind,
          tenantPdfConfig,
        );
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private draw(
    doc: PDFKit.PDFDocument,
    factura: PrismaAny,
    facturaExt: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    logoBuffer: Buffer | null,
    copia: 'ORIGINAL' | 'DUPLICADO',
    comprobante: ArcaComprobanteCvlp,
    asociados: Array<{ tipo: number; ptoVenta: number; nro: number }>,
    showTestWatermark: boolean,
    kind: 'factura' | 'nc',
    tenantPdfConfig: TenantPdfConfig = null,
  ) {
    const M = MARGIN;
    const CW = COL_W;
    let y = M;
    // Color de acento elegido por la empresa (ArcaConfig.colorFactura); sin color, los grises de siempre.
    const col = pdfColoresComprobante(config?.colorFactura);

    doc.rect(M, y, CW, 18).stroke(col.linea('#000'));
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor(col.texto('#000'))
      .text(copia, M, y + 5, { width: CW, align: 'center' });
    y += 22;

    // Encabezado con el formato del comprobante de ARCA: dos mitades (emisor | datos del
    // comprobante) y el recuadro de la letra centrado en la hoja, sobre la línea divisoria.
    const hdrH = 108;
    doc.rect(M, y, CW, hdrH).stroke(col.linea('#aaa'));
    const midX = M + CW / 2;
    const BOX_W = 46;
    const BOX_H = 42;
    doc.moveTo(midX, y + BOX_H).lineTo(midX, y + hdrH).stroke(col.linea('#aaa'));

    {
      const hasLogo = Boolean(logoBuffer);
      const LOGO_H = 44;
      // Mitad izquierda, sin pisar el recuadro de la letra.
      const colX = M + 8;
      const colW = CW / 2 - BOX_W / 2 - 16;
      const emisor = config?.razonSocial ?? '';

      // Arriba: el logo (si hay) o la razón social destacada, centrados como en ARCA.
      let logoOk = false;
      if (hasLogo) {
        try {
          doc.image(logoBuffer as Buffer, colX, y + 6, {
            fit: [colW, LOGO_H],
            align: 'center',
            valign: 'center',
          });
          logoOk = true;
        } catch {
          // logo ilegible: cae a la razón social
        }
      }
      if (!logoOk) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
          .text(emisor, colX, y + 18, { width: colW, align: 'center' });
      }

      // Abajo: los datos con la etiqueta en negrita, anclados al pie del encabezado.
      const condEmisorLabel = config?.condicionIvaEmisor
        ? (CONDICION_IVA_LABEL[Number(config.condicionIvaEmisor)] ?? config.condicionIvaEmisor)
        : '';
      const datos: Array<[string, string]> = [
        ['Razón Social', emisor],
        ['Domicilio Comercial', config?.domicilioEmisor ?? ''],
        ['Condición frente al IVA', condEmisorLabel],
      ];
      doc.fontSize(7.5);
      const alto = (label: string, valor: string) =>
        doc.font('Helvetica').heightOfString(`${label}: ${valor}`, { width: colW });
      let ly = y + hdrH - 6 - datos.reduce((acc, [l, v]) => acc + alto(l, v) + 3, 0) + 3;
      for (const [label, valor] of datos) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#000')
          .text(`${label}: `, colX, ly, { width: colW, continued: true })
          .font('Helvetica')
          .text(valor);
        ly += alto(label, valor) + 3;
      }
    }

    const cbteTipo = facturaExt.cbteTipo ?? 6;
    const letra = LETRA_POR_TIPO[cbteTipo] ?? 'B';

    {
      // Recuadro de la letra (RG 1415: solo letra + código), centrado en la hoja.
      const boxX = midX - BOX_W / 2;
      doc.rect(boxX, y, BOX_W, BOX_H).fillAndStroke('#fff', col.linea('#000'));
      doc.fontSize(26).font('Helvetica-Bold').fillColor(col.texto('#000'))
        .text(letra, boxX, y + 3, { width: BOX_W, align: 'center' });
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000')
        .text(`COD. ${String(cbteTipo).padStart(2, '0')}`, boxX, y + BOX_H - 10, { width: BOX_W, align: 'center' });
    }

    {
      const titleX = midX + BOX_W / 2 + 12;
      const titleW = M + CW - titleX - 8;
      doc.fontSize(18).font('Helvetica-Bold').fillColor(col.texto('#000'))
        .text(`${TITULO_POR_TIPO[cbteTipo] ?? 'FACTURA'} ${letra}`, titleX, y + 8, { width: titleW });

      // "Etiqueta: valor" con la etiqueta en negrita, como el comprobante de ARCA.
      const linea = (label: string, valor: string, x: number, ly: number, w: number) => {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
          .text(`${label}: `, x, ly, { width: w, continued: true })
          .font('Helvetica')
          .text(valor);
      };

      let dy = y + 38;
      if (facturaExt.cbteNro && facturaExt.ptoVenta) {
        const mitad = titleW / 2;
        linea('Punto de Venta', String(facturaExt.ptoVenta).padStart(5, '0'), titleX, dy, mitad);
        linea('Comp. Nro', String(facturaExt.cbteNro).padStart(8, '0'), titleX + mitad, dy, mitad);
      } else {
        linea('Número', String(factura.numero ?? ''), titleX, dy, titleW);
      }
      dy += 12;
      linea('Fecha de Emisión', fmtDate(factura.fechaEmision), titleX, dy, titleW);
      dy += 18;
      linea('CUIT', String(config?.cuitEmisor ?? ''), titleX, dy, titleW);
      dy += 12;
      linea('Ingresos Brutos', String(config?.ingBrutos ?? config?.cuitEmisor ?? ''), titleX, dy, titleW);
      dy += 12;
      linea('Fecha de Inicio de Actividades', String(config?.inicActEmisor ?? ''), titleX, dy, titleW);
    }

    y += hdrH + 2;

    {
      const c = factura.cliente;
      const condLabel = c?.condicionIva
        ? (CONDICION_IVA_LABEL[c.condicionIva] ?? String(c.condicionIva))
        : '';
      const colW = CW / 2 - 8;
      const nameText = `Sr.(es): ${c?.nombre ?? ''}`;
      const domText = `Domicilio: ${c?.direccion ?? ''}`;

      // Condición de venta: días de vencimiento de la propia factura (fecha de vencimiento −
      // emisión, ambas a medianoche UTC) o, si no tiene, la condición de pago del cliente.
      const diasVto = factura.fechaVencimiento && factura.fechaEmision
        ? Math.round(
            (new Date(factura.fechaVencimiento).getTime() - new Date(factura.fechaEmision).getTime()) /
              86_400_000,
          )
        : (c?.condicionPagoDias ?? null);
      const condicionVenta = diasVto != null && diasVto > 0
        ? `Cta Cte – Vto ${diasVto} días`
        : 'Cta Cte';
      // Leyenda libre de la empresa (ArcaConfig.leyendaFactura, ej. intereses por mora), en
      // letra chica debajo de la condición de venta. Solo en facturas, no en notas de crédito.
      const leyenda = kind === 'factura' ? String(config?.leyendaFactura ?? '').trim() : '';
      const LEYENDA_FONT = 6;
      doc.fontSize(LEYENDA_FONT).font('Helvetica');
      const leyendaH = leyenda ? doc.heightOfString(leyenda, { width: colW }) + 3 : 0;
      doc.fontSize(7.5);

      const nameH = doc.heightOfString(nameText, { width: colW });
      const domH = doc.heightOfString(domText, { width: colW });
      const leftTotalH = 5 + nameH + 2 + domH + 2 + 10 + 2 + 10 + 5;
      const rightTotalH = kind === 'nc' ? (5 + 12 * 4) : (5 + 12 + leyendaH + 12 + 5);
      const rcpH = Math.max(leftTotalH, rightTotalH, 48);

      doc.rect(M, y, CW, rcpH).stroke(col.linea('#aaa'));
      doc.moveTo(M + CW / 2, y).lineTo(M + CW / 2, y + rcpH).stroke(col.linea('#aaa'));

      let ly = y + 5;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
        .text(nameText, M + 4, ly, { width: colW });
      ly += nameH + 2;

      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text(domText, M + 4, ly, { width: colW });
      ly += domH + 2;

      doc.text(`Cond. IVA: ${condLabel}`, M + 4, ly, { width: colW });
      ly += 12;

      doc.text(`C.U.I.T.: ${c?.idFiscal ?? ''}`, M + 4, ly, { width: colW });

      const rx = M + CW / 2 + 4;
      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text(`Condición de Venta: ${condicionVenta}`, rx, y + 5, { width: colW });
      if (leyenda) {
        doc.fontSize(LEYENDA_FONT).font('Helvetica').fillColor('#555')
          .text(leyenda, rx, y + 16, { width: colW });
      }
      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text('Moneda: Pesos', rx, y + 17 + leyendaH, { width: colW });

      if (kind === 'nc') {
        const refCbteNro = facturaExt.cbteNro && facturaExt.ptoVenta
          ? `${String(facturaExt.ptoVenta).padStart(4, '0')}-${String(facturaExt.cbteNro).padStart(8, '0')}`
          : factura.numero;
        doc.text(`Factura Orig.: ${refCbteNro || ''}`, rx, y + 29, { width: colW });
        doc.text(`Motivo: ${factura.motivoAnulacion || 'Anulación de comprobante'}`, rx, y + 41, { width: colW });
      }

      y += rcpH + 2;
    }

    // Sin columna "Producto" (absorbida por "Detalle"): su ancho pasa a esa columna.
    const colWidths = [257.28, 40, 65, 65, 42, 70];
    const colX: number[] = [];
    let cx = M;
    for (const w of colWidths) { colX.push(cx); cx += w; }
    const tableW = CW;
    const headerRowH = 16;
    const cellPadY = 4;
    const cellPadX = 2;

    // "Cantidad" genérico: la unidad (TN/UD) va solo en las líneas de viaje.
    const tHeaders = ['Detalle', 'Cantidad', 'Tarifa', 'SubTotal', 'IVA %', 'SubTotal c/IVA'];
    doc.rect(M, y, tableW, headerRowH).fill(col.fondoEncabezadoTabla('#e8e8e8')).stroke('#aaa');
    tHeaders.forEach((h, i) => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(col.textoEncabezadoTabla('#000'))
        .text(h, colX[i] + cellPadX, y + cellPadY, {
          width: colWidths[i] - cellPadX * 2,
          align: i >= 1 ? 'right' : 'left',
        });
    });
    y += headerRowH;

    for (const item of comprobante.items) {
      const detalleDraw = buildDetalleFlete(item, factura.viajes, tenantPdfConfig);
      const esLineaViaje = matchViajeItem(item, factura.viajes) != null;
      const cells = [
        { v: detalleDraw.toUpperCase(), align: 'left' as const },
        {
          v:
            item.cantidad != null
              ? esLineaViaje
                ? `${fmtNum(item.cantidad)} ${normalizeUnidadCantidad(tenantPdfConfig?.unidadCantidadViajes)}`
                : fmtNum(item.cantidad)
              : '1,00',
          align: 'right' as const,
        },
        { v: fmtNum(item.precioUnitario ?? item.importeBase), align: 'right' as const },
        { v: fmtNum(item.importeBase), align: 'right' as const },
        { v: fmtNum(item.ivaPct), align: 'right' as const },
        { v: fmtNum(item.subtotal), align: 'right' as const },
      ];

      // Altura dinámica: descripciones largas (ej. viaje con origen/destino) wrappean
      // y no deben solaparse con "Comprobantes asociados" debajo.
      doc.fontSize(7).font('Helvetica');
      let contentH = 0;
      for (let i = 0; i < cells.length; i++) {
        const h = doc.heightOfString(cells[i].v, {
          width: colWidths[i] - cellPadX * 2,
        });
        if (h > contentH) contentH = h;
      }
      const rowH = Math.max(headerRowH, contentH + cellPadY * 2);

      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      cells.forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + cellPadX, y + cellPadY, {
            width: colWidths[i] - cellPadX * 2,
            align: cell.align,
          });
      });
      y += rowH;
    }

    if (asociados.length > 0) {
      y += 8;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
        .text('Comprobantes asociados', M, y, { width: CW });
      y += 14;
      for (const asoc of asociados) {
        const nro = `${String(asoc.ptoVenta).padStart(4, '0')}-${String(asoc.nro).padStart(8, '0')}`;
        const label = `Tipo ${String(asoc.tipo).padStart(3, '0')}  N° ${nro}`;
        doc.fontSize(7.5).font('Helvetica').fillColor('#333')
          .text(label, M + 4, y, { width: CW - 8 });
        y += 12;
      }
    }

    const footerY = PAGE_H - MARGIN - 90;
    doc.moveTo(M, footerY - 4).lineTo(M + CW, footerY - 4).stroke(col.linea('#aaa'));

    const pie = cvlpPdfPieFinanciero(
      {
        bruto: comprobante.impNeto,
        comision: 0,
        gastosAdminIva: comprobante.impIva,
        liquido: comprobante.impTotal,
      },
      comprobante,
    );
    const impTotal = pie.total;
    doc.fontSize(7).font('Helvetica').fillColor('#333')
      .text(`Son: ${numeroALetras(impTotal).toLowerCase()}`, M, footerY, { width: CW });

    const footerBoxY = footerY + 12;
    const footerBoxH = 70;
    doc.rect(M, footerBoxY, CW, footerBoxH).stroke(col.linea('#aaa'));

    if (qrBuffer) {
      doc.image(qrBuffer, M + 4, footerBoxY + 4, { width: 62, height: 62 });
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
      .text('ARCA', M + 72, footerBoxY + 14, { width: 150 });
    doc.fontSize(6).font('Helvetica').fillColor('#555')
      .text('AGENCIA DE RECAUDACIÓN', M + 72, footerBoxY + 27, { width: 150 })
      .text('Y CONTROL ADUANERO', M + 72, footerBoxY + 34, { width: 150 });

    const totX = M + CW - 200;
    const labelW = 120;
    const valW = 70;
    doc.fontSize(7.5).font('Helvetica').fillColor('#000');
    const totRows: [string, string][] = [
      ['Importe Neto Gravado: $', fmtNum(pie.netoGravado)],
      ['Importe Otros Tributos: $', fmtNum(pie.otrosTributos)],
      ['IVA: $', fmtNum(pie.iva)],
      ['Importe Total: $', fmtNum(impTotal)],
    ];

    let currentY = footerBoxY + 6;
    totRows.forEach(([label, val]) => {
      const labelHeight = doc.heightOfString(label, { width: labelW });
      const valHeight = doc.heightOfString(val, { width: valW });
      const rowHeight = Math.max(labelHeight, valHeight, 10);
      doc.text(label, totX, currentY, { width: labelW, align: 'left', lineBreak: true });
      doc.font('Helvetica-Bold').text(val, totX + labelW, currentY, { width: valW, align: 'right' });
      doc.font('Helvetica');
      currentY += rowHeight + 1.5;
    });

    currentY = Math.max(currentY, footerBoxY + 52);

    if (facturaExt.cae) {
      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`CAE N°: ${facturaExt.cae}`, totX, currentY, { width: 190 })
        .text(`Vto CAE: ${fmtDate(facturaExt.caeFechaVto)}`, totX, currentY + 10, { width: 190 });
    } else {
      doc.fontSize(7.5).font('Helvetica').fillColor('#999')
        .text('Pendiente de emisión (sin CAE)', totX, currentY, { width: 190 });
    }

    // Al final de la página: encima del contenido, sin taparlo (opacity).
    if (showTestWatermark) {
      drawHomologacionWatermark(doc);
    }
  }
}
