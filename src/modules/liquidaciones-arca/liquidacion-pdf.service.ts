import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArcaConfigService } from './arca-config.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

const CONDICION_IVA_LABEL: Record<number, string> = {
  1: 'RESP. INSCRIPTO',
  4: 'IVA SUJETO EXENTO',
  5: 'CONSUMIDOR FINAL',
  6: 'RESP. MONOTRIBUTO',
};

const TIPO_CBTE_LABEL: Record<number, string> = {
  1: 'A',
  6: 'B',
  11: 'C',
  60: 'COD. 060',
  61: 'COD. 061',
};

// ── Helpers numéricos ─────────────────────────────────────────────────────────

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
const DECENAS = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function tresDigitos(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const centStr = c > 0 ? CENTENAS[c] : '';
  if (resto === 0) return centStr;
  if (resto < 20) return [centStr, UNIDADES[resto]].filter(Boolean).join(' ');
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const decStr = u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`;
  return [centStr, decStr].filter(Boolean).join(' ');
}

function numeroALetras(n: number): string {
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  if (entero === 0) return `CERO CON ${centavos.toString().padStart(2, '0')}/100`;

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];
  if (millones > 0) partes.push(`${tresDigitos(millones)} ${millones === 1 ? 'MILLÓN' : 'MILLONES'}`);
  if (miles > 0) partes.push(`${miles === 1 ? 'MIL' : `${tresDigitos(miles)} MIL`}`);
  if (resto > 0) partes.push(tresDigitos(resto));

  const letras = partes.join(' ');
  return `${letras} CON ${centavos.toString().padStart(2, '0')}/100 PESOS`;
}

// ── PDF builder ───────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const COL_W = PAGE_W - MARGIN * 2;

@Injectable()
export class LiquidacionPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arcaConfig: ArcaConfigService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  async generate(tenantId: string, liquidacionId: string): Promise<Buffer> {
    const liq = await this.db.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: {
        transportista: {
          select: { id: true, nombre: true, idFiscal: true, condicionIva: true, domicilio: true, pais: true },
        },
        viajes: {
          include: {
            viaje: {
              select: {
                id: true, numero: true, fechaCarga: true, fechaDescarga: true,
                origen: true, destino: true, metadata: true,
              },
            },
          },
        },
      },
    });

    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }

    const config = await this.arcaConfig.findPublic(tenantId);

    // QR solo si tiene CAE
    let qrBuffer: Buffer | null = null;
    if (liq.cae && liq.cbteNro && liq.ptoVenta) {
      const cuitNum = Number(String(liq.transportista?.idFiscal ?? '0').replace(/-/g, ''));
      const payload = {
        ver: 1,
        fecha: liq.createdAt.toISOString().slice(0, 10),
        cuit: Number(String(config?.cuitEmisor ?? '0').replace(/-/g, '')),
        ptoVta: liq.ptoVenta,
        tipoCmp: liq.cbteTipo,
        nroCmp: liq.cbteNro,
        importe: Math.round(liq.liquido * 100) / 100,
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: 80,
        nroDocRec: cuitNum,
        tipoCodAut: 'E',
        codAut: Number(liq.cae),
      };
      const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
      qrBuffer = await QRCode.toBuffer(qrUrl, { width: 72, margin: 1 }) as Buffer;
    }

    return this.buildPdf(liq, config, qrBuffer);
  }

  private buildPdf(
    liq: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.draw(doc, liq, config, qrBuffer, 'ORIGINAL');
        doc.addPage();
        this.draw(doc, liq, config, qrBuffer, 'DUPLICADO');
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private draw(
    doc: PDFKit.PDFDocument,
    liq: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    copia: 'ORIGINAL' | 'DUPLICADO',
  ) {
    const M = MARGIN;
    const CW = COL_W;
    let y = M;

    // ── Barra superior ORIGINAL/DUPLICADO ───────────────────────────────────
    doc.rect(M, y, CW, 18).fill('#1a1a1a');
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('white')
      .text(copia, M, y + 4, { width: CW, align: 'center' });
    y += 22;

    // ── Sección 1: emisor | tipo | título ────────────────────────────────────
    const hdrH = 90;
    doc.rect(M, y, CW, hdrH).stroke('#aaa');

    // Líneas divisoras verticales
    const c1x = M + 160;  // fin col emisor
    const c2x = M + 230;  // fin col tipo
    doc.moveTo(c1x, y).lineTo(c1x, y + hdrH).stroke('#aaa');
    doc.moveTo(c2x, y).lineTo(c2x, y + hdrH).stroke('#aaa');

    // Col 1: emisor
    const emisor = config?.razonSocial ?? 'NyM Logística';
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
      .text(emisor, M + 6, y + 8, { width: 148 });
    const condEmisorLabel = config?.condicionIvaEmisor
      ? (CONDICION_IVA_LABEL[Number(config.condicionIvaEmisor)] ?? config.condicionIvaEmisor)
      : '';
    doc.fontSize(7).font('Helvetica').fillColor('#333')
      .text(config?.domicilioEmisor ?? '', M + 6, y + 22, { width: 148 })
      .text(condEmisorLabel, M + 6, y + 32, { width: 148 });
    doc.fontSize(7).font('Helvetica').fillColor('#555')
      .text(`CUIT: ${config?.cuitEmisor ?? ''}`, M + 6, y + 44, { width: 148 })
      .text(`Ing. Brutos: ${config?.ingBrutos ?? config?.cuitEmisor ?? ''}`, M + 6, y + 54, { width: 148 })
      .text(`Inic. Act.: ${config?.inicActEmisor ?? ''}`, M + 6, y + 64, { width: 148 });

    // Col 2: letra + tipo
    const tipoStr = TIPO_CBTE_LABEL[liq.cbteTipo] ?? String(liq.cbteTipo);
    const isLetter = liq.cbteTipo === 1 || liq.cbteTipo === 6 || liq.cbteTipo === 11;
    if (isLetter) {
      doc.rect(c1x + 4, y + 6, 60, 60).stroke('#000');
      doc.fontSize(36).font('Helvetica-Bold').fillColor('#000')
        .text(tipoStr, c1x + 4, y + 14, { width: 60, align: 'center' });
    }
    const codLabel = liq.cbteTipo === 60 ? 'COD. 060' : liq.cbteTipo === 61 ? 'COD. 061' : '';
    if (codLabel) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
        .text(codLabel, c1x + 4, y + 36, { width: 60, align: 'center' });
    }

    // Col 3: título + datos
    const titleX = c2x + 6;
    const titleW = CW - (c2x - M) - 6;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
      .text('CUENTA DE VENTA Y LIQUIDO PRODUCTO', titleX, y + 6, { width: titleW });

    const cbteNroStr = liq.cbteNro
      ? `${String(liq.ptoVenta).padStart(4, '0')}-${String(liq.cbteNro).padStart(8, '0')}`
      : 'BORRADOR';
    doc.fontSize(8).font('Helvetica').fillColor('#000')
      .text(`Número: ${cbteNroStr}`, titleX, y + 38, { width: titleW })
      .text(`Fecha: ${fmtDate(liq.createdAt)}`, titleX, y + 49, { width: titleW })
      .text(`CUIT: ${config?.cuitEmisor ?? ''}`, titleX, y + 60, { width: titleW })
      .text(`Inic. Act.: ${config?.inicActEmisor ?? ''}`, titleX, y + 71, { width: titleW });

    y += hdrH + 2;

    // ── Sección 2: receptor (transportista) ──────────────────────────────────
    const rcpH = 48;
    doc.rect(M, y, CW, rcpH).stroke('#aaa');
    doc.moveTo(M + CW / 2, y).lineTo(M + CW / 2, y + rcpH).stroke('#aaa');

    const t = liq.transportista;
    const condLabel = t?.condicionIva ? (CONDICION_IVA_LABEL[t.condicionIva] ?? String(t.condicionIva)) : '';
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
      .text(`Sr.(es): ${t?.nombre ?? ''}`, M + 4, y + 5, { width: CW / 2 - 8 });
    doc.fontSize(7.5).font('Helvetica').fillColor('#333')
      .text(`Domicilio: ${t?.domicilio ?? ''}`, M + 4, y + 17, { width: CW / 2 - 8 })
      .text(`Cond. IVA: ${condLabel}`, M + 4, y + 28, { width: CW / 2 - 8 })
      .text(`C.U.I.T.: ${t?.idFiscal ?? ''}`, M + 4, y + 38, { width: CW / 2 - 8 });

    const rx2 = M + CW / 2 + 4;
    doc.fontSize(7.5).font('Helvetica').fillColor('#333')
      .text('Condición de Venta: CTA CTE', rx2, y + 5, { width: CW / 2 - 8 })
      .text('Moneda: Pesos', rx2, y + 17, { width: CW / 2 - 8 })
      .text(`C.U.I.T.: ${t?.idFiscal ?? ''}`, rx2, y + 28, { width: CW / 2 - 8 });

    y += rcpH + 2;

    // ── Sección 3: origen/destino (del primer viaje) ──────────────────────────
    const firstViaje = liq.viajes?.[0]?.viaje;
    if (firstViaje?.origen || firstViaje?.destino) {
      const odH = 30;
      doc.rect(M, y, CW, odH).stroke('#aaa');
      doc.moveTo(M + CW / 2, y).lineTo(M + CW / 2, y + odH).stroke('#aaa');
      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text(`Origen: ${firstViaje.origen ?? ''}`, M + 4, y + 10, { width: CW / 2 - 8 });
      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text(`Destino: ${firstViaje.destino ?? ''}`, M + CW / 2 + 4, y + 10, { width: CW / 2 - 8 });
      y += odH + 2;
    }

    // ── Tabla de ítems ────────────────────────────────────────────────────────
    const colWidths = [100, 168, 44, 65, 65, 38, 70]; // total = ~550
    const colX: number[] = [];
    let cx = M;
    for (const w of colWidths) { colX.push(cx); cx += w; }
    const tableW = CW;
    const rowH = 16;

    // Header
    const tHeaders = ['Producto', 'Descripción', 'Cantidad', 'Precio', 'SubTotal', 'IVA %', 'SubTotal c/IVA'];
    doc.rect(M, y, tableW, rowH).fill('#e8e8e8').stroke('#aaa');
    tHeaders.forEach((h, i) => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000')
        .text(h, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: i >= 2 ? 'right' : 'left' });
    });
    y += rowH;

    // Rows de viajes
    for (const lv of liq.viajes ?? []) {
      const v = lv.viaje;
      const meta = (v?.metadata as Record<string, unknown>) ?? {};
      const cp = String(meta.cartaDePorte ?? '');
      const ctg = String(meta.ctg ?? '');
      const grano = String(meta.grano ?? '');
      const desc = ['SERV. DE TRANSPORTE', cp ? `CP:${cp}` : '', ctg ? `CTG:${ctg}` : '', grano]
        .filter(Boolean).join(' ');
      const tn = lv.tnDestino ?? 0;
      const tarifa = lv.tarifaTransportista ?? 0;
      const sub = lv.subtotal ?? 0;
      const subIva = sub * 1.21;

      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      const cells = [
        { v: 'SERVICIOS LOGISTICOS', align: 'left' },
        { v: desc, align: 'left' },
        { v: fmtNum(tn), align: 'right' },
        { v: fmtNum(tarifa), align: 'right' },
        { v: fmtNum(sub), align: 'right' },
        { v: '21.00', align: 'right' },
        { v: fmtNum(subIva), align: 'right' },
      ];
      cells.forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: cell.align as 'left' | 'right' });
      });
      y += rowH;
    }

    // Fila comisión (negativa)
    {
      const comDesc = `COMISION TRANSPORTE ${fmtNum(liq.comisionPct, 1)}%`;
      const comIva = -liq.comision * 1.21;
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      [
        { v: 'COMISION TRANSPORTE', a: 'left' },
        { v: comDesc, a: 'left' },
        { v: '1,00', a: 'right' },
        { v: fmtNum(-liq.comision), a: 'right' },
        { v: fmtNum(-liq.comision), a: 'right' },
        { v: '21.00', a: 'right' },
        { v: fmtNum(comIva), a: 'right' },
      ].forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: cell.a as 'left' | 'right' });
      });
      y += rowH;
    }

    // Fila gastos admin (si > 0, IVA 0%)
    if (liq.gastosAdmin > 0) {
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      [
        { v: 'GASTOS ADMINISTRATIVO', a: 'left' },
        { v: 'GASTOS ADMINISTRATIVO', a: 'left' },
        { v: '1,00', a: 'right' },
        { v: fmtNum(-liq.gastosAdmin), a: 'right' },
        { v: fmtNum(-liq.gastosAdmin), a: 'right' },
        { v: '0.00', a: 'right' },
        { v: fmtNum(-liq.gastosAdmin), a: 'right' },
      ].forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: cell.a as 'left' | 'right' });
      });
      y += rowH;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - MARGIN - 90;
    // Línea divisora
    doc.moveTo(M, footerY - 4).lineTo(M + CW, footerY - 4).stroke('#aaa');

    // "Son:"
    const impTotal = liq.liquido;
    doc.fontSize(7).font('Helvetica').fillColor('#333')
      .text(`Son: ${numeroALetras(impTotal).toLowerCase()}`, M, footerY, { width: CW });

    const footerBoxY = footerY + 12;
    const footerBoxH = 70;
    doc.rect(M, footerBoxY, CW, footerBoxH).stroke('#aaa');

    // QR
    if (qrBuffer) {
      doc.image(qrBuffer, M + 4, footerBoxY + 4, { width: 62, height: 62 });
    }

    // ARCA text
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
      .text('ARCA', M + 72, footerBoxY + 14, { width: 80 });
    doc.fontSize(6).font('Helvetica').fillColor('#555')
      .text('AGENCIA DE RECAUDACIÓN', M + 72, footerBoxY + 27, { width: 80 })
      .text('Y CONTROL ADUANERO', M + 72, footerBoxY + 34, { width: 80 });

    // Totales (derecha)
    const impNeto = liq.bruto - liq.comision - liq.gastosAdmin;
    const iva = liq.gastosAdminIva;
    const totX = M + CW - 200;
    const totW = 190;
    doc.fontSize(7.5).font('Helvetica').fillColor('#000');
    const totRows: [string, string][] = [
      ['Importe Neto Gravado: $', fmtNum(impNeto)],
      ['Importe Otros Tributos: $', '0,00'],
      ['IVA: $', fmtNum(iva)],
      ['Importe Total: $', fmtNum(impTotal)],
    ];
    totRows.forEach(([label, val], i) => {
      const ry = footerBoxY + 6 + i * 12;
      doc.text(label, totX, ry, { width: 130, align: 'left' });
      doc.font('Helvetica-Bold').text(val, totX + 130, ry, { width: 60, align: 'right' });
      doc.font('Helvetica');
    });

    if (liq.cae) {
      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`CAE N°: ${liq.cae}`, totX, footerBoxY + 54, { width: 190 })
        .text(`Vto CAE: ${fmtDate(liq.caeFechaVto)}`, totX, footerBoxY + 64, { width: 190 });
    } else {
      doc.fontSize(7.5).font('Helvetica').fillColor('#999')
        .text('Pendiente de emisión (sin CAE)', totX, footerBoxY + 54, { width: 190 });
    }
  }
}
