import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArcaConfigService } from './arca-config.service';
import { buildComprobanteCvlp } from './arca-cvlp.util';
import { cvlpPdfPieFinanciero, resolveIvaPct } from './arca-iva.util';
import {
  buildFacturaConceptosList,
  defaultFacturaLineas,
} from './factura-conceptos.util';
import { ArcaComprobanteCvlp } from './types/arca.types';

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
  6: 'B',
  11: 'C',
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
          },
        },
        viajes: {
          select: {
            numero: true,
            monto: true,
            origen: true,
            destino: true,
          },
        },
      },
    });

    if (!factura || factura.tenantId !== tenantId) {
      throw new NotFoundException('Factura no encontrada');
    }

    const config = await this.arcaConfig.findPublic(tenantId);
    const facturaExt = factura as typeof factura & {
      cbteTipo?: number | null;
      cbteNro?: number | null;
      ptoVenta?: number | null;
      cae?: string | null;
      caeFechaVto?: Date | null;
    };

    let qrBuffer: Buffer | null = null;
    if (facturaExt.cae && facturaExt.cbteNro && facturaExt.ptoVenta) {
      const docNroRec = factura.cliente?.idFiscal
        ? Number(String(factura.cliente.idFiscal).replace(/-/g, ''))
        : 0;
      const impTotal =
        facturaExt.cae
          ? await this.resolveImpTotal(facturaId, factura, config)
          : factura.importe;
      const payload = {
        ver: 1,
        fecha: factura.fechaEmision.toISOString().slice(0, 10),
        cuit: Number(String(config?.cuitEmisor ?? '0').replace(/-/g, '')),
        ptoVta: facturaExt.ptoVenta,
        tipoCmp: facturaExt.cbteTipo ?? 6,
        nroCmp: facturaExt.cbteNro,
        importe: Math.round(impTotal * 100) / 100,
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: docNroRec ? 80 : 99,
        nroDocRec: docNroRec,
        tipoCodAut: 'E',
        codAut: Number(facturaExt.cae),
      };
      const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
      qrBuffer = await QRCode.toBuffer(qrUrl, { width: 72, margin: 1 }) as Buffer;
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

    const comprobante = await this.resolveComprobante(factura, config);
    const buffer = await this.buildPdf(factura, facturaExt, config, qrBuffer, logoBuffer, comprobante);

    const cbteNroStr = facturaExt.cbteNro && facturaExt.ptoVenta
      ? `${String(facturaExt.ptoVenta).padStart(4, '0')}-${String(facturaExt.cbteNro).padStart(8, '0')}`
      : factura.numero.slice(0, 20);
    const clienteSlug = slugify(factura.cliente?.nombre ?? 'cliente');
    const letra = LETRA_POR_TIPO[facturaExt.cbteTipo ?? 6] ?? 'B';
    const filename = `Factura_${letra}_${cbteNroStr}_${clienteSlug}.pdf`;

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

  private async resolveComprobante(
    factura: PrismaAny,
    config: PrismaAny,
  ): Promise<ArcaComprobanteCvlp> {
    if (factura.cae) {
      const log = await this.db.arcaLog.findFirst({
        where: { facturaId: factura.id, exitoso: true, method: 'FECAESolicitar' },
        orderBy: { createdAt: 'desc' },
      });
      const metadata = (log?.requestBody as { auditMetadata?: ArcaComprobanteCvlp })?.auditMetadata;
      if (metadata && Array.isArray(metadata.items)) {
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
      fechaCbte: factura.fechaEmision.toISOString().slice(0, 10).replace(/-/g, ''),
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
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.draw(doc, factura, facturaExt, config, qrBuffer, logoBuffer, 'ORIGINAL', comprobante);
        doc.addPage();
        this.draw(doc, factura, facturaExt, config, qrBuffer, logoBuffer, 'DUPLICADO', comprobante);
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
  ) {
    const M = MARGIN;
    const CW = COL_W;
    let y = M;

    doc.rect(M, y, CW, 18).stroke('#000');
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#000')
      .text(copia, M, y + 5, { width: CW, align: 'center' });
    y += 22;

    const hdrH = 108;
    doc.rect(M, y, CW, hdrH).stroke('#aaa');
    const c1x = M + 160;
    const c2x = M + 230;
    doc.moveTo(c1x, y).lineTo(c1x, y + hdrH).stroke('#aaa');
    doc.moveTo(c2x, y).lineTo(c2x, y + hdrH).stroke('#aaa');

    {
      const hasLogo = Boolean(logoBuffer);
      const LOGO_SIZE = 40;
      const colW = 150;
      const colX = M + 5;
      let cy = y + 6;

      if (hasLogo) {
        try {
          doc.image(logoBuffer as Buffer, M + (160 - LOGO_SIZE) / 2, cy, { fit: [LOGO_SIZE, LOGO_SIZE] });
          cy += LOGO_SIZE + 4;
          doc.fontSize(6).font('Helvetica-Oblique').fillColor('#555')
            .text('de', colX, cy, { width: colW, align: 'center' });
          cy += 9;
        } catch {
          // sin logo
        }
      }

      const align = hasLogo ? 'center' : 'left';
      const emisor = config?.razonSocial ?? '';
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
        .text(emisor, colX, cy, { width: colW, align });
      cy += doc.heightOfString(emisor, { width: colW }) + 3;

      const domicilioTxt = config?.domicilioEmisor ?? '';
      doc.fontSize(6.5).font('Helvetica').fillColor('#333')
        .text(domicilioTxt, colX, cy, { width: colW, align });
      cy += doc.heightOfString(domicilioTxt, { width: colW }) + 3;

      const condEmisorLabel = config?.condicionIvaEmisor
        ? (CONDICION_IVA_LABEL[Number(config.condicionIvaEmisor)] ?? config.condicionIvaEmisor)
        : '';
      doc.fontSize(6.5).font('Helvetica').fillColor('#333')
        .text(condEmisorLabel, colX, cy, { width: colW, align });
    }

    {
      const cbteTipo = facturaExt.cbteTipo ?? 6;
      const tipoStr = LETRA_POR_TIPO[cbteTipo] ?? 'B';
      doc.rect(c1x + 4, y + 6, 60, 60).stroke('#000');
      doc.fontSize(36).font('Helvetica-Bold').fillColor('#000')
        .text(tipoStr, c1x + 4, y + 14, { width: 60, align: 'center' });
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
        .text(`COD. ${String(cbteTipo).padStart(3, '0')}`, c1x + 4, y + 72, { width: 60, align: 'center' });
    }

    {
      const titleX = c2x + 6;
      const titleW = CW - (c2x - M) - 6;
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
        .text('FACTURA', titleX, y + 6, { width: titleW });

      const cbteNroStr = facturaExt.cbteNro && facturaExt.ptoVenta
        ? `${String(facturaExt.ptoVenta).padStart(4, '0')}-${String(facturaExt.cbteNro).padStart(8, '0')}`
        : factura.numero;

      const dataY = y + 42;
      const subColW = titleW / 2 - 6;
      const rColX = titleX + subColW + 10;

      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`Número: ${cbteNroStr}`, titleX, dataY, { width: subColW })
        .text(`Fecha: ${fmtDate(factura.fechaEmision)}`, titleX, dataY + 13, { width: subColW });

      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`CUIT: ${config?.cuitEmisor ?? ''}`, rColX, dataY, { width: subColW })
        .text(`Ing. Brutos: ${config?.ingBrutos ?? config?.cuitEmisor ?? ''}`, rColX, dataY + 13, { width: subColW })
        .text(`Inic. Act.: ${config?.inicActEmisor ?? ''}`, rColX, dataY + 26, { width: subColW });
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

      const nameH = doc.heightOfString(nameText, { width: colW });
      const domH = doc.heightOfString(domText, { width: colW });
      const leftTotalH = 5 + nameH + 2 + domH + 2 + 10 + 2 + 10 + 5;
      const rcpH = Math.max(leftTotalH, 48);

      doc.rect(M, y, CW, rcpH).stroke('#aaa');
      doc.moveTo(M + CW / 2, y).lineTo(M + CW / 2, y + rcpH).stroke('#aaa');

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
        .text('Condición de Venta: CTA CTE', rx, y + 5, { width: colW })
        .text('Moneda: Pesos', rx, y + 17, { width: colW });

      y += rcpH + 2;
    }

    const colWidths = [100, 157.28, 40, 65, 65, 42, 70];
    const colX: number[] = [];
    let cx = M;
    for (const w of colWidths) { colX.push(cx); cx += w; }
    const tableW = CW;
    const rowH = 16;

    const tHeaders = ['Producto', 'Descripción', 'Cantidad', 'Precio', 'SubTotal', 'IVA %', 'SubTotal c/IVA'];
    doc.rect(M, y, tableW, rowH).fill('#e8e8e8').stroke('#aaa');
    tHeaders.forEach((h, i) => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000')
        .text(h, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: i >= 2 ? 'right' : 'left' });
    });
    y += rowH;

    for (const item of comprobante.items) {
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      const cells = [
        { v: item.descripcion.toUpperCase(), align: 'left' },
        { v: item.descripcion.toUpperCase(), align: 'left' },
        { v: '1,00', align: 'right' },
        { v: fmtNum(item.importeBase), align: 'right' },
        { v: fmtNum(item.importeBase), align: 'right' },
        { v: fmtNum(item.ivaPct), align: 'right' },
        { v: fmtNum(item.subtotal), align: 'right' },
      ];
      cells.forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: cell.align as 'left' | 'right' });
      });
      y += rowH;
    }

    const footerY = PAGE_H - MARGIN - 90;
    doc.moveTo(M, footerY - 4).lineTo(M + CW, footerY - 4).stroke('#aaa');

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
    doc.rect(M, footerBoxY, CW, footerBoxH).stroke('#aaa');

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
  }
}
