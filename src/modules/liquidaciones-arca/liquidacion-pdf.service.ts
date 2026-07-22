import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArcaConfigService } from './arca-config.service';
import {
  cvlpPdfPieFinanciero,
  formatAlicuotaIva,
  resolveIvaPct,
  subtotalConIva,
} from './arca-iva.util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

const CONDICION_IVA_LABEL: Record<number, string> = {
  1: 'RESP. INSCRIPTO',
  4: 'IVA SUJETO EXENTO',
  5: 'CONSUMIDOR FINAL',
  6: 'RESP. MONOTRIBUTO',
};

// Letra mostrada en el recuadro grande del comprobante. CVLP (60/61) se factura
// fiscalmente como A/B según el destinatario, por eso comparte letra con Factura A/B.
const LETRA_POR_TIPO: Record<number, string> = {
  1: 'A',
  6: 'B',
  11: 'C',
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
// El 20 se escribe como palabra única igual que el 11-19 ("veintiuno", no "veinte y uno").
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

  const letras = partes.join(' ');
  return `${letras} CON ${centavosStr} CENTAVO(S)`;
}

/** Nombre de archivo legible: quita acentos y caracteres no válidos para un filesystem. */
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
  return clean.slice(0, 60) || 'liquidacion';
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
  ) { }

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  async generate(
    tenantId: string,
    liquidacionId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
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
                origen: true, destino: true,
                cliente: { select: { id: true, nombre: true, idFiscal: true, direccion: true } },
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

    // Logo del emisor, descargado una sola vez (se reutiliza en ORIGINAL y DUPLICADO)
    let logoBuffer: Buffer | null = null;
    if (config?.logoUrl) {
      try {
        const fetched = await fetch(config.logoUrl);
        if (fetched.ok) logoBuffer = Buffer.from(await fetched.arrayBuffer());
      } catch(e) { console.error("LOGO ERROR:", e);
        // Si el logo no se puede descargar, el PDF se genera igual sin él.
      }
    }

    const buffer = await this.buildPdf(liq, config, qrBuffer, logoBuffer);

    const cbteNroStr = liq.cbteNro
      ? `${String(liq.ptoVenta).padStart(4, '0')}-${String(liq.cbteNro).padStart(8, '0')}`
      : liquidacionId.slice(0, 8);
    const transportistaSlug = slugify(liq.transportista?.nombre ?? '');
    const filename = `CVLP_${cbteNroStr}_${transportistaSlug}.pdf`;

    return { buffer, filename };
  }

  private buildPdf(
    liq: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    logoBuffer: Buffer | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.draw(doc, liq, config, qrBuffer, logoBuffer, 'ORIGINAL');
        doc.addPage();
        this.draw(doc, liq, config, qrBuffer, logoBuffer, 'DUPLICADO');
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
    logoBuffer: Buffer | null,
    copia: 'ORIGINAL' | 'DUPLICADO',
  ) {
    const M = MARGIN;
    const CW = COL_W;
    let y = M;

    // ── Barra superior ORIGINAL/DUPLICADO (caja con borde, sin relleno) ───────
    doc.rect(M, y, CW, 18).stroke('#000');
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#000')
      .text(copia, M, y + 5, { width: CW, align: 'center' });
    y += 22;

    // ── Sección 1: emisor | tipo | título ────────────────────────────────────
    const hdrH = 108;
    doc.rect(M, y, CW, hdrH).stroke('#aaa');

    // Líneas divisoras verticales
    const c1x = M + 160;  // fin col emisor
    const c2x = M + 230;  // fin col tipo
    doc.moveTo(c1x, y).lineTo(c1x, y + hdrH).stroke('#aaa');
    doc.moveTo(c2x, y).lineTo(c2x, y + hdrH).stroke('#aaa');

    // Col 1: logo (si existe) + razón social + domicilio + condición IVA
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
        } catch(e) { console.error("LOGO ERROR:", e);
          // Formato de imagen no soportado por pdfkit; se sigue sin logo.
        }
      }

      const align = hasLogo ? 'center' : 'left';
      const emisor = config?.razonSocial ?? 'NyM Logística';
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

    // Col 2: letra + tipo
    const isLetter = liq.cbteTipo === 1 || liq.cbteTipo === 6 || liq.cbteTipo === 11;
    const isCvlp = liq.cbteTipo === 60 || liq.cbteTipo === 61;
    
    if (isLetter) {
      const tipoStr = LETRA_POR_TIPO[liq.cbteTipo] ?? String(liq.cbteTipo);
      doc.rect(c1x + 4, y + 6, 60, 60).stroke('#000');
      doc.fontSize(36).font('Helvetica-Bold').fillColor('#000')
        .text(tipoStr, c1x + 4, y + 14, { width: 60, align: 'center' });
        
      const codLabel = `COD. ${String(liq.cbteTipo).padStart(3, '0')}`;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
        .text(codLabel, c1x + 4, y + 72, { width: 60, align: 'center' });
    } else if (isCvlp) {
      // Diseño especial para CVLP: "COD." arriba y el número grande abajo adentro del recuadro
      doc.rect(c1x + 4, y + 6, 60, 60).stroke('#000');
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
        .text('COD.', c1x + 4, y + 16, { width: 60, align: 'center' });
      doc.fontSize(28).font('Helvetica-Bold').fillColor('#000')
        .text(String(liq.cbteTipo).padStart(3, '0'), c1x + 4, y + 32, { width: 60, align: 'center' });
    }

    // Col 3: título + datos del comprobante (Número/Fecha a la izq., CUIT/Ing.Brutos/Inic.Act a la der.)
    {
      const titleX = c2x + 6;
      const titleW = CW - (c2x - M) - 6;
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
        .text('CUENTA DE VENTA Y LIQUIDO PRODUCTO', titleX, y + 6, { width: titleW });

      const cbteNroStr = liq.cbteNro
        ? `${String(liq.ptoVenta).padStart(4, '0')}-${String(liq.cbteNro).padStart(8, '0')}`
        : 'BORRADOR';

      const dataY = y + 42;
      const subColW = titleW / 2 - 6;
      const rColX = titleX + subColW + 10;

      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`Número: ${cbteNroStr}`, titleX, dataY, { width: subColW })
        .text(`Fecha: ${fmtDate(liq.createdAt)}`, titleX, dataY + 13, { width: subColW });

      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`CUIT: ${config?.cuitEmisor ?? ''}`, rColX, dataY, { width: subColW })
        .text(`Ing. Brutos: ${config?.ingBrutos ?? config?.cuitEmisor ?? ''}`, rColX, dataY + 13, { width: subColW })
        .text(`Inic. Act.: ${config?.inicActEmisor ?? ''}`, rColX, dataY + 26, { width: subColW });
    }

    y += hdrH + 2;

    // ── Sección 2: receptor (transportista) ──────────────────────────────────
    {
      const t = liq.transportista;
      const condLabel = t?.condicionIva ? (CONDICION_IVA_LABEL[t.condicionIva] ?? String(t.condicionIva)) : '';
      const colW = CW / 2 - 8;
      const nameText = `Sr.(es): ${t?.nombre ?? ''}`;
      const domText = `Domicilio: ${t?.domicilio ?? ''}`;

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

      doc.text(`C.U.I.T.: ${t?.idFiscal ?? ''}`, M + 4, ly, { width: colW });

      const rx = M + CW / 2 + 4;
      doc.fontSize(7.5).font('Helvetica').fillColor('#333')
        .text('Condición de Venta: CTA CTE', rx, y + 5, { width: colW })
        .text('Moneda: Pesos', rx, y + 17, { width: colW })
        .text(`C.U.I.T.: ${t?.idFiscal ?? ''}`, rx, y + 28, { width: colW });

      y += rcpH + 2;
    }

    // ── Sección 3: receptor (cliente del viaje) + origen/destino ─────────────
    {
      const firstViaje = liq.viajes?.[0]?.viaje;
      const cliente = firstViaje?.cliente;
      if (cliente || firstViaje?.origen || firstViaje?.destino) {
        const colW = CW / 2 - 8;
        const clienteNameText = `Sr.(es): ${cliente?.nombre ?? ''}`;
        const clienteDomText = `Domicilio: ${cliente?.direccion ?? ''}`;

        const nameH = doc.heightOfString(clienteNameText, { width: colW });
        const domH = doc.heightOfString(clienteDomText, { width: colW });

        const leftTotalH = 5 + nameH + 2 + domH + 2 + 10 + 5;
        const odH = Math.max(leftTotalH, 40);

        doc.rect(M, y, CW, odH).stroke('#aaa');
        doc.moveTo(M + CW / 2, y).lineTo(M + CW / 2, y + odH).stroke('#aaa');

        let ly = y + 5;
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
          .text(clienteNameText, M + 4, ly, { width: colW });
        ly += nameH + 2;

        doc.fontSize(7.5).font('Helvetica').fillColor('#333')
          .text(clienteDomText, M + 4, ly, { width: colW });
        ly += domH + 2;

        doc.text(`C.U.I.T.: ${cliente?.idFiscal ?? ''}`, M + 4, ly, { width: colW });

        const rx = M + CW / 2 + 4;
        doc.fontSize(7.5).font('Helvetica').fillColor('#333')
          .text(`Origen: ${firstViaje?.origen ?? ''}`, rx, y + 5, { width: colW })
          .text(`Destino: ${firstViaje?.destino ?? ''}`, rx, y + 17, { width: colW });

        y += odH + 2;
      }
    }

    // ── Tabla de ítems ────────────────────────────────────────────────────────
    const colWidths = [100, 157.28, 40, 65, 65, 42, 70]; // total = 539.28 (CW)
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

    // Misma alícuota que se usa al autorizar contra ARCA (config del emisor).
    const ivaPct = resolveIvaPct(config?.ivaGastosAdmin);
    const ivaPctLabel = formatAlicuotaIva(ivaPct);

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
      const subIva = subtotalConIva(sub, ivaPct);

      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      const cells = [
        { v: 'SERVICIOS LOGISTICOS', align: 'left' },
        { v: desc, align: 'left' },
        { v: fmtNum(tn), align: 'right' },
        { v: fmtNum(tarifa), align: 'right' },
        { v: fmtNum(sub), align: 'right' },
        { v: ivaPctLabel, align: 'right' },
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
      const comIva = subtotalConIva(-liq.comision, ivaPct);
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      [
        { v: 'COMISION TRANSPORTE', a: 'left' },
        { v: comDesc, a: 'left' },
        { v: '1,00', a: 'right' },
        { v: fmtNum(-liq.comision), a: 'right' },
        { v: fmtNum(-liq.comision), a: 'right' },
        { v: ivaPctLabel, a: 'right' },
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

    // Fila seguro de carga (si > 0, IVA 0%) — placeholder: todavía no existe como
    // dato de negocio en Liquidacion; queda lista para cuando se modele el campo real.
    const seguroCarga = 0;
    if (seguroCarga > 0) {
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      [
        { v: 'SEGURO DE CARGA', a: 'left' },
        { v: 'SEGURO DE CARGA', a: 'left' },
        { v: '1,00', a: 'right' },
        { v: fmtNum(-seguroCarga), a: 'right' },
        { v: fmtNum(-seguroCarga), a: 'right' },
        { v: '0.00', a: 'right' },
        { v: fmtNum(-seguroCarga), a: 'right' },
      ].forEach((cell, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(cell.v, colX[i] + 2, y + 4, { width: colWidths[i] - 4, align: cell.a as 'left' | 'right' });
      });
      y += rowH;
    }

    // Líneas "combustible en ruta" / "efectivo en ruta" — placeholder: ídem, en $0
    // hasta que existan como dato real; hoy no se dibujan porque siempre valen 0.
    const combustibleEnRuta = 0;
    const efectivoEnRuta = 0;
    const extraLineas: [string, number][] = [
      ['COMBUSTIBLE EN RUTA $', combustibleEnRuta],
      ['EFECTIVO EN RUTA $', efectivoEnRuta],
    ];
    for (const [label, val] of extraLineas) {
      if (val === 0) continue;
      doc.rect(M, y, tableW, rowH).stroke('#ddd');
      doc.fontSize(7).font('Helvetica').fillColor('#000')
        .text(label, M + 4, y + 4, { width: tableW - 90 })
        .text(fmtNum(val), M + tableW - 84, y + 4, { width: 80, align: 'right' });
      y += rowH;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - MARGIN - 90;
    // Línea divisora
    doc.moveTo(M, footerY - 4).lineTo(M + CW, footerY - 4).stroke('#aaa');

    // Pie: montos persistidos (= autorizados por CAE). Neto + Otros + IVA = Total.
    const pie = cvlpPdfPieFinanciero(liq);
    const impTotal = pie.total;
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
      .text('ARCA', M + 72, footerBoxY + 14, { width: 150 });
    doc.fontSize(6).font('Helvetica').fillColor('#555')
      .text('AGENCIA DE RECAUDACIÓN', M + 72, footerBoxY + 27, { width: 150 })
      .text('Y CONTROL ADUANERO', M + 72, footerBoxY + 34, { width: 150 });

    // Totales (derecha)
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

    if (liq.cae) {
      doc.fontSize(7.5).font('Helvetica').fillColor('#000')
        .text(`CAE N°: ${liq.cae}`, totX, currentY, { width: 190 })
        .text(`Vto CAE: ${fmtDate(liq.caeFechaVto)}`, totX, currentY + 10, { width: 190 });
    } else {
      doc.fontSize(7.5).font('Helvetica').fillColor('#999')
        .text('Pendiente de emisión (sin CAE)', totX, currentY, { width: 190 });
    }
  }
}
