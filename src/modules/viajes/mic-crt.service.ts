import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: new (opts?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument = require('pdfkit');
import { PrismaService } from '../../shared/prisma/prisma.service';

interface MicCrtMeta {
  mic?: string;
  crt?: string;
  kgCarga?: number;
  kgDescarga?: number;
  bultos?: number;
  tipoBultos?: string;
  precintos?: string;
  aduanaDestino?: string;
  ruta?: string;
  seguroUsd?: number;
}

type MicVehiculo = {
  patente: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  nroChasis: string | null;
};

type MicViaje = {
  numero: string;
  origen: string | null;
  destino: string | null;
  detalleCarga: string | null;
  fechaCarga: Date | null;
  fechaDescarga: Date | null;
  monto: number | null;
  monedaMonto: string | null;
  precioTransportistaExterno: number | null;
  metadata: unknown;
  cliente: { nombre: string; idFiscal: string | null; direccion: string | null } | null;
  transportista: { nombre: string; idFiscal: string | null } | null;
  chofer: { nombre: string; dni: string | null; licencia: string | null } | null;
  vehiculosViaje: Array<{ orden: number; vehiculo: MicVehiculo }>;
};

@Injectable()
export class MicCrtService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(viajeId: string, tenantId: string): Promise<Buffer> {
    console.log('[MIC-CRT] generate() llamado para viaje:', viajeId, 'tenant:', tenantId);
    const viaje = (await this.prisma.viaje.findFirst({
      where: { id: viajeId, tenantId },
      include: {
        cliente: { select: { nombre: true, idFiscal: true, direccion: true } },
        transportista: { select: { nombre: true, idFiscal: true } },
        chofer: { select: { nombre: true, dni: true, licencia: true } },
        vehiculosViaje: {
          orderBy: { orden: 'asc' },
          include: {
            vehiculo: {
              select: {
                patente: true,
                tipo: true,
                marca: true,
                modelo: true,
                anio: true,
                nroChasis: true,
              },
            },
          },
        },
      },
    })) as unknown as MicViaje | null;

    console.log('[MIC-CRT] viaje encontrado:', !!viaje);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    const missing: string[] = [];
    if (!viaje.origen?.trim()) missing.push('Origen del viaje');
    if (!viaje.destino?.trim()) missing.push('Destino del viaje');
    if (!viaje.detalleCarga?.trim()) missing.push('Detalle de carga');
    if (!viaje.chofer) missing.push('Chofer asignado al viaje');
    else {
      if (!viaje.chofer.nombre?.trim()) missing.push('Nombre del chofer');
      if (!viaje.chofer.dni?.trim()) missing.push('DNI / CI del chofer');
    }
    if (viaje.vehiculosViaje.length === 0)
      missing.push('Al menos un vehículo asignado al viaje (patente del camión)');
    if (!viaje.cliente) missing.push('Cliente del viaje');

    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Faltan datos obligatorios para generar el MIC/CRT',
        missing,
      });
    }

    const meta = ((viaje.metadata ?? {}) as MicCrtMeta);
    const sorted = [...viaje.vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const camion = sorted[0]?.vehiculo ?? null;
    const semi =
      sorted.find((vv) => vv.vehiculo.tipo === 'semirremolque')?.vehiculo ??
      (sorted.length > 1 ? sorted[1]?.vehiculo : null);

    console.log('[MIC-CRT] Datos OK, generando PDF. missing:', missing.length, 'camion:', camion?.patente);
    return this.buildPdf(viaje, meta, camion, semi);
  }

  private buildPdf(
    v: MicViaje,
    meta: MicCrtMeta,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[MIC-CRT] Creando PDFDocument...');
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => {
          console.log('[MIC-CRT] PDF generado OK, chunks:', chunks.length);
          resolve(Buffer.concat(chunks));
        });
        doc.on('error', (e) => {
          console.error('[MIC-CRT] Error en stream del PDF:', e);
          reject(e);
        });

        console.log('[MIC-CRT] Dibujando MIC/DTA...');
        this.drawMicDta(doc, v, meta, camion, semi);
        console.log('[MIC-CRT] Dibujando CRT...');
        doc.addPage();
        this.drawCrt(doc, v, meta, camion, semi);
        console.log('[MIC-CRT] Finalizando PDF...');
        doc.end();
      } catch (syncErr) {
        console.error('[MIC-CRT] Error síncrono en buildPdf:', syncErr);
        reject(syncErr);
      }
    });
  }

  // ─── Helpers de dibujo ────────────────────────────────────────────────────

  private cell(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    num: string,
    label: string,
    value: string,
    opts: { bold?: boolean; valueFontSize?: number } = {},
  ) {
    doc.rect(x, y, w, h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text(num, x + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(` ${label}`, x + 2 + 8, y + 2, { lineBreak: false });
    const fs = opts.valueFontSize ?? 8;
    const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(fs).text(value || '—', x + 3, y + 13, {
      width: w - 6,
      height: h - 16,
      lineBreak: true,
    });
  }

  private hdr(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, text: string) {
    doc.rect(x, y, w, h).fillAndStroke('#1a1a1a', '#000');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7).text(text, x + 3, y + (h - 7) / 2, {
      width: w - 6,
      align: 'center',
    });
    doc.fillColor('black');
  }

  private fmt(d: Date | string | null | undefined): string {
    if (!d) return '';
    const dt = typeof d === 'string' ? new Date(d) : d;
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const yy = dt.getUTCFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  private fmtMonto(val: number | null | undefined, moneda?: string | null): string {
    if (val == null) return '';
    return `${moneda === 'USD' ? 'USD ' : 'ARS '}${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // ─── Página 1: MIC/DTA ────────────────────────────────────────────────────

  private drawMicDta(
    doc: PDFKit.PDFDocument,
    v: MicViaje,
    meta: MicCrtMeta,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ) {
    const M = 20;
    const W = 555;
    const x0 = M;
    let y = M;

    // ── Título ──────────────────────────────────────────────────────────────
    doc.rect(x0, y, W, 24).fill('#1a1a1a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
      .text('MIC/DTA', x0 + 3, y + 4);
    doc.font('Helvetica-Bold').fontSize(8.5)
      .text(
        'MANIFIESTO INTERNACIONAL DE CARGA POR CARRETERA / DECLARACIÓN DE TRÁNSITO ADUANERO',
        x0 + 55, y + 4,
        { width: W - 60, align: 'center' },
      );
    doc.font('Helvetica').fontSize(6.5)
      .text(
        'Manifiesto Internacional de Carga Rodoviária / Declaração de Trânsito Aduaneiro',
        x0 + 55, y + 14,
        { width: W - 60, align: 'center' },
      );
    doc.fillColor('black');
    y += 24;

    // ── Fila 1: Porteador | Tránsito + N° MIC ───────────────────────────────
    const col1w = Math.round(W * 0.58);
    const col2w = W - col1w;
    const f1h = 46;

    const porteador = v.transportista
      ? `${v.transportista.nombre}${v.transportista.idFiscal ? `\nCUIT: ${v.transportista.idFiscal}` : ''}`
      : v.cliente?.nombre ?? '';

    this.cell(doc, x0, y, col1w, f1h, '1', 'Nombre y domicilio del porteador', porteador, { valueFontSize: 8 });

    // Subcelda tránsito
    doc.rect(x0 + col1w, y, col2w, f1h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('3', x0 + col1w + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Tránsito aduanero', x0 + col1w + 10, y + 2, { lineBreak: false });
    doc.rect(x0 + col1w + 3, y + 12, 6, 6).stroke();
    doc.font('Helvetica-Bold').fontSize(7).text('X', x0 + col1w + 4, y + 12, { lineBreak: false });
    doc.font('Helvetica').fontSize(7).text('Sí / Sim', x0 + col1w + 12, y + 13, { lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(6.5).text('4', x0 + col1w + 2, y + 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' N°', x0 + col1w + 10, y + 22, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).text(meta.mic ?? v.numero, x0 + col1w + 3, y + 30, {
      width: col2w - 6,
      align: 'center',
    });

    y += f1h;

    // ── Fila 2: Rol contribuyente | Hoja + Fecha ────────────────────────────
    const f2h = 22;
    this.cell(doc, x0, y, col1w, f2h, '2', 'Rol de contribuyente / Cadastro geral de contribuintes',
      v.transportista?.idFiscal ?? '');
    // Hoja
    const hojaw = Math.round(col2w * 0.35);
    this.cell(doc, x0 + col1w, y, hojaw, f2h, '5', 'Hoja / Folha', '1 / 1');
    // Fecha emisión
    this.cell(doc, x0 + col1w + hojaw, y, col2w - hojaw, f2h, '6', 'Fecha Emisión / Data de emissão',
      this.fmt(v.fechaCarga ?? new Date()));
    y += f2h;

    // ── Fila 3: Ciudad partida ───────────────────────────────────────────────
    const f3h = 22;
    this.cell(doc, x0, y, W, f3h, '7', 'Aduana, ciudad y país de partida / Alfândega, cidade e país de partida',
      v.origen ?? '', { valueFontSize: 9, bold: true });
    y += f3h;

    // ── Fila 4: Ciudad destino ───────────────────────────────────────────────
    this.cell(doc, x0, y, W, f3h, '8', 'Ciudad y país de destino final / Cidade e país de destino final',
      v.destino ?? '', { valueFontSize: 9, bold: true });
    y += f3h;

    // ── Fila 5: Datos del camión ─────────────────────────────────────────────
    const f5h = 40;
    const propietario = v.transportista?.nombre ?? v.cliente?.nombre ?? '';
    const c9w  = Math.round(W * 0.28);
    const c10w = Math.round(W * 0.14);
    const c11w = Math.round(W * 0.14);
    const c12w = Math.round(W * 0.24);
    const c14w = Math.round(W * 0.10);
    const c15w = W - c9w - c10w - c11w - c12w - c14w;

    this.cell(doc, x0, y, c9w, f5h, '9', 'Camión original — Propietario', propietario);
    this.cell(doc, x0 + c9w, y, c10w, f5h, '10', 'Rol contribuyente', v.transportista?.idFiscal ?? '');
    this.cell(doc, x0 + c9w + c10w, y, c11w, f5h, '11', 'Placa del camión', camion?.patente ?? '');
    const marcaNum = camion
      ? `${camion.marca ?? ''} ${camion.modelo ?? ''}\n${camion.nroChasis ?? ''}`.trim()
      : '';
    this.cell(doc, x0 + c9w + c10w + c11w, y, c12w, f5h, '12', 'Marca y número / Marca e número', marcaNum);
    this.cell(doc, x0 + c9w + c10w + c11w + c12w, y, c14w, f5h, '14', 'Año / Ano',
      camion?.anio ? String(camion.anio) : '');
    const semiInfo = semi ? `${semi.tipo === 'semirremolque' ? 'SR' : 'R'} ${semi.patente}` : '';
    this.cell(doc, x0 + c9w + c10w + c11w + c12w + c14w, y, c15w, f5h, '15', 'Semi/Rem.', semiInfo);
    y += f5h;

    // ── Fila 6: Carta de porte + Aduana destino + Moneda + Origen ────────────
    const f6h = 22;
    const c23w = Math.round(W * 0.30);
    const c24w = Math.round(W * 0.28);
    const c25w = Math.round(W * 0.12);
    const c26w = W - c23w - c24w - c25w;

    this.cell(doc, x0, y, c23w, f6h, '23', 'N° Carta de porte', meta.crt ?? '');
    this.cell(doc, x0 + c23w, y, c24w, f6h, '24', 'Aduana de destino', meta.aduanaDestino ?? '');
    this.cell(doc, x0 + c23w + c24w, y, c25w, f6h, '25', 'Moneda', v.monedaMonto === 'USD' ? 'DOL' : 'ARS');
    this.cell(doc, x0 + c23w + c24w + c25w, y, c26w, f6h, '26', 'Origen mercancías',
      v.origen ? v.origen.split(/[-,]/)[0].trim() : '');
    y += f6h;

    // ── Fila 7: Valores ──────────────────────────────────────────────────────
    const f7h = 22;
    const c27w = Math.round(W * 0.32);
    const c28w = Math.round(W * 0.32);
    const c29w = W - c27w - c28w;

    this.cell(doc, x0, y, c27w, f7h, '27', 'Valor FOT / Valor FOT',
      this.fmtMonto(v.monto, v.monedaMonto));
    this.cell(doc, x0 + c27w, y, c28w, f7h, '28', 'Flete en U$S / Frete em U$S',
      this.fmtMonto(v.precioTransportistaExterno, v.monedaMonto));
    this.cell(doc, x0 + c27w + c28w, y, c29w, f7h, '29', 'Seguro en U$S',
      meta.seguroUsd != null ? `USD ${meta.seguroUsd.toFixed(2)}` : '.00');
    y += f7h;

    // ── Fila 8: Bultos ───────────────────────────────────────────────────────
    const f8h = 22;
    const c30w = Math.round(W * 0.32);
    const c31w = Math.round(W * 0.32);
    const c32w = W - c30w - c31w;

    this.cell(doc, x0, y, c30w, f8h, '30', 'Tipo de bultos / Tipo dos volumes',
      meta.tipoBultos ?? 'PALETA');
    this.cell(doc, x0 + c30w, y, c31w, f8h, '31', 'Cantidad de bultos', meta.bultos ? String(meta.bultos) : '');
    this.cell(doc, x0 + c30w + c31w, y, c32w, f8h, '32', 'Peso bruto (kg.)',
      meta.kgCarga ? meta.kgCarga.toLocaleString('es-AR') : '');
    y += f8h;

    // ── Fila 9: Remitente | Destinatario + Consignatario ─────────────────────
    const f9h = 50;
    const halfW = Math.round(W / 2);
    const clienteInfo = v.cliente
      ? `${v.cliente.nombre}${v.cliente.idFiscal ? `\nCUIT: ${v.cliente.idFiscal}` : ''}${v.cliente.direccion ? `\n${v.cliente.direccion}` : ''}`
      : '';

    this.cell(doc, x0, y, halfW, f9h, '33', 'Remitente / Remetente', clienteInfo);
    this.cell(doc, x0 + halfW, y, W - halfW, f9h, '34', 'Destinatario', clienteInfo);
    y += f9h;

    const f10h = 30;
    this.cell(doc, x0, y, W, f10h, '35', 'Consignatario', clienteInfo);
    y += f10h;

    // ── Fila 11: Docs Anexos | Precintos ─────────────────────────────────────
    const f11h = 22;
    this.cell(doc, x0, y, halfW, f11h, '36', 'Documentos Anexos', '');
    this.cell(doc, x0 + halfW, y, W - halfW, f11h, '37', 'Número de precintos / Número dos lacres',
      meta.precintos ?? '');
    y += f11h;

    // ── Fila 12: Descripción mercancías ──────────────────────────────────────
    const f12h = 55;
    this.cell(doc, x0, y, W, f12h, '38',
      'Marcas y números de los bultos, descripción de las mercancías',
      v.detalleCarga ?? '', { valueFontSize: 8.5 });
    y += f12h;

    // ── Fila 13: Ruta DTA ────────────────────────────────────────────────────
    const f13h = 42;
    const rutaVal = meta.ruta
      ? `${meta.ruta}\nFecha Prevista de Arribo: ${this.fmt(v.fechaDescarga)}`
      : `Fecha Prevista de Arribo: ${this.fmt(v.fechaDescarga)}`;
    const conductorVal = v.chofer
      ? `CONDUCTOR 1: ${v.chofer.nombre}    DOC: CI ${v.chofer.dni ?? ''}${v.chofer.licencia ? `    LIC: ${v.chofer.licencia}` : ''}`
      : '';
    this.cell(doc, x0, y, W, f13h, '40',
      'N° DTA, ruta y plazo de transporte',
      `${rutaVal}\n${conductorVal}`);
    y += f13h;

    // ── Fila 14: Firmas ──────────────────────────────────────────────────────
    const remainH = Math.max(841 - M - y, 30);
    const f14h = remainH;
    doc.rect(x0, y, halfW, f14h).stroke();
    doc.rect(x0 + halfW, y, W - halfW, f14h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5)
      .text('39  Firma y sello del porteador / Assinatura e carimbo do transportador', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(6.5)
      .text('41  Firma y sello de Aduana de Partida', x0 + halfW + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
      .text(`Fecha / Data: ${this.fmt(v.fechaCarga)}`, x0 + 2, y + 12, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
      .text(`Fecha / Data:`, x0 + halfW + 2, y + 12, { lineBreak: false });
  }

  // ─── Página 2: CRT ────────────────────────────────────────────────────────

  private drawCrt(
    doc: PDFKit.PDFDocument,
    v: MicViaje,
    meta: MicCrtMeta,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ) {
    void camion;
    void semi;

    const M = 20;
    const W = 555;
    const x0 = M;
    let y = M;

    // ── Título ──────────────────────────────────────────────────────────────
    doc.rect(x0, y, W, 28).fill('#1a1a1a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
      .text('CRT', x0 + 3, y + 4);
    doc.font('Helvetica-Bold').fontSize(8.5)
      .text('CARTA DE PORTE INTERNACIONAL POR CARRETERA', x0 + 40, y + 4, { width: W - 45, align: 'center' });
    doc.font('Helvetica').fontSize(6.5)
      .text('Conhecimento de Transporte Internacional por Rodovia', x0 + 40, y + 15, {
        width: W - 45, align: 'center',
      });
    doc.fillColor('black');
    y += 28;

    const clienteInfo = v.cliente
      ? `${v.cliente.nombre}${v.cliente.idFiscal ? `  CUIT: ${v.cliente.idFiscal}` : ''}${v.cliente.direccion ? `\n${v.cliente.direccion}` : ''}`
      : '';
    const porteador = v.transportista
      ? `${v.transportista.nombre}${v.transportista.idFiscal ? `  CUIT: ${v.transportista.idFiscal}` : ''}`
      : v.cliente?.nombre ?? '';

    const halfW = Math.round(W / 2);

    // ── Fila 1: Remitente | N° CRT ───────────────────────────────────────────
    const f1h = 38;
    this.cell(doc, x0, y, halfW, f1h, '1', 'Nombre y domicilio del remitente / Nome e endereço do remetente', clienteInfo);
    this.cell(doc, x0 + halfW, y, W - halfW, f1h, '2', 'Número / Número', meta.crt ?? v.numero, { valueFontSize: 11, bold: true });
    y += f1h;

    // ── Fila 2: Porteador | Lugar emisión ────────────────────────────────────
    const f2h = 34;
    this.cell(doc, x0, y, halfW, f2h, '3', 'Nombre y domicilio del porteador', porteador);
    this.cell(doc, x0 + halfW, y, W - halfW, f2h, '5', 'Lugar y país de emisión', v.origen ?? '');
    y += f2h;

    // ── Fila 3: Destinatario | Fecha y lugar de carga ────────────────────────
    const f3h = 34;
    this.cell(doc, x0, y, halfW, f3h, '4', 'Nombre y domicilio del destinatario', clienteInfo);
    this.cell(doc, x0 + halfW, y, W - halfW, f3h, '7',
      'Lugar, país y fecha en que el porteador se hace cargo de las mercancías',
      `${v.origen ?? ''}   ${this.fmt(v.fechaCarga)}`);
    y += f3h;

    // ── Fila 4: Consignatario | Plazo entrega ────────────────────────────────
    const f4h = 34;
    this.cell(doc, x0, y, halfW, f4h, '6', 'Nombre y domicilio del consignatario', clienteInfo);
    this.cell(doc, x0 + halfW, y, W - halfW, f4h, '8',
      'Lugar, país y plazo de entrega',
      `${v.destino ?? ''}   ${this.fmt(v.fechaDescarga)}`);
    y += f4h;

    // ── Fila 5: Notificar | Porteadores sucesivos ─────────────────────────────
    const f5h = 28;
    this.cell(doc, x0, y, halfW, f5h, '9', 'Notificar a', clienteInfo);
    this.cell(doc, x0 + halfW, y, W - halfW, f5h, '10', 'Porteadores sucesivos', '');
    y += f5h;

    // ── Fila 6: Descripción mercancías | Peso ────────────────────────────────
    const f6h = 65;
    const descW = Math.round(W * 0.68);
    const pesoW = W - descW;
    this.cell(doc, x0, y, descW, f6h, '11',
      'Cantidad y clase de bultos, marcas y números, tipo de mercancías',
      `${meta.bultos ? meta.bultos + ' ' + (meta.tipoBultos ?? 'PALETAS') : ''}\n${v.detalleCarga ?? ''}`,
      { valueFontSize: 8 });
    // Peso
    doc.rect(x0 + descW, y, pesoW, f6h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('12', x0 + descW + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Peso bruto (kg.)', x0 + descW + 10, y + 2, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9)
      .text(meta.kgCarga ? `PB: ${meta.kgCarga.toLocaleString('es-AR')}` : '', x0 + descW + 3, y + 13);
    doc.font('Helvetica').fontSize(8)
      .text(meta.kgDescarga ? `PN: ${meta.kgDescarga.toLocaleString('es-AR')}` : '', x0 + descW + 3, y + 26);
    doc.font('Helvetica-Bold').fontSize(6.5).text('13', x0 + descW + 2, y + 40, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Volumen m³', x0 + descW + 12, y + 40, { lineBreak: false });
    y += f6h;

    // ── Fila 7: Valor | Declaración ──────────────────────────────────────────
    const f7h = 35;
    const valorW = Math.round(W * 0.32);
    const declW = W - valorW;
    doc.rect(x0, y, valorW, f7h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('14', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Valor / Valor', x0 + 12, y + 2, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10)
      .text(this.fmtMonto(v.monto, v.monedaMonto), x0 + 3, y + 14, { width: valorW - 6, align: 'center' });
    doc.font('Helvetica').fontSize(7).text(v.monedaMonto === 'USD' ? 'CPT' : '', x0 + 3, y + 26, { width: valorW - 6, align: 'center' });

    this.cell(doc, x0 + valorW, y, declW, f7h, '16', 'Declaración del valor de las mercancías',
      v.monto ? `SON ${v.monedaMonto === 'USD' ? 'DÓLARES ESTADOUNIDENSES' : 'PESOS ARGENTINOS'} ${v.monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '');
    y += f7h;

    // ── Fila 8: Gastos | Documentos anexos ───────────────────────────────────
    const f8h = 55;
    const gastosW = Math.round(W * 0.42);
    const docsW = W - gastosW;

    doc.rect(x0, y, gastosW, f8h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('15', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Gastos a pagar', x0 + 12, y + 2, { lineBreak: false });
    // Headers tabla gastos
    const gx = x0;
    const col1 = 90; const col2 = 75; const col3 = 75; const col4 = (gastosW - col1 - col2 - col3);
    doc.font('Helvetica-Bold').fontSize(6)
      .text('Concepto', gx + 2, y + 12)
      .text('Remitente', gx + col1 + 2, y + 12)
      .text('Destinatario', gx + col1 + col2 + 2, y + 12)
      .text('Moneda', gx + col1 + col2 + col3 + 2, y + 12);
    doc.moveTo(gx, y + 20).lineTo(gx + gastosW, y + 20).stroke();
    doc.font('Helvetica').fontSize(7.5)
      .text('Flete / Frete', gx + 2, y + 24)
      .text('.00', gx + col1 + 2, y + 24)
      .text(v.precioTransportistaExterno ? v.precioTransportistaExterno.toFixed(2) : '.00', gx + col1 + col2 + 2, y + 24)
      .text(v.monedaMonto === 'USD' ? 'USD' : 'ARS', gx + col1 + col2 + col3 + 2, y + 24);
    doc.font('Helvetica').fontSize(7.5)
      .text('Seguro / Seguro', gx + 2, y + 34)
      .text('.00', gx + col1 + 2, y + 34)
      .text('.00', gx + col1 + col2 + 2, y + 34);
    doc.font('Helvetica-Bold').fontSize(7.5)
      .text('TOTAL', gx + 2, y + 44)
      .text('.00', gx + col1 + 2, y + 44)
      .text(v.precioTransportistaExterno ? v.precioTransportistaExterno.toFixed(2) : '.00', gx + col1 + col2 + 2, y + 44)
      .text(v.monedaMonto === 'USD' ? 'USD' : 'ARS', gx + col1 + col2 + col3 + 2, y + 44);

    this.cell(doc, x0 + gastosW, y, docsW, f8h, '17', 'Documentos anexos', '');
    y += f8h;

    // ── Fila 9: Instrucciones aduana ─────────────────────────────────────────
    const f9h = 22;
    this.cell(doc, x0, y, W, f9h, '18', 'Instrucciones sobre formalidades de aduana', 'N');
    y += f9h;

    // ── Firmas ───────────────────────────────────────────────────────────────
    const remainH = Math.max(841 - M - y, 36);
    const fh = remainH;
    const fw = Math.round(W / 3);

    doc.rect(x0, y, fw, fh).stroke();
    doc.rect(x0 + fw, y, fw, fh).stroke();
    doc.rect(x0 + fw * 2, y, W - fw * 2, fh).stroke();

    doc.font('Helvetica-Bold').fontSize(6.5)
      .text('21  Nombre y firma del remitente o su representante', x0 + 2, y + 2)
      .text(v.cliente?.nombre ?? '', x0 + 2, y + 11);
    doc.font('Helvetica').fontSize(6.5)
      .text('Fecha / Data: ____________________', x0 + 2, y + Math.max(fh - 12, 16));

    doc.font('Helvetica-Bold').fontSize(6.5)
      .text('23  Nombre, firma y sello del porteador', x0 + fw + 2, y + 2)
      .text(porteador.split('\n')[0], x0 + fw + 2, y + 11);
    doc.font('Helvetica').fontSize(6.5)
      .text('Fecha / Data: ____________________', x0 + fw + 2, y + Math.max(fh - 12, 16));

    doc.font('Helvetica-Bold').fontSize(6.5)
      .text('24  Nombre y firma del destinatario o su representante', x0 + fw * 2 + 2, y + 2);
    doc.font('Helvetica').fontSize(6.5)
      .text('Fecha / Data: ____________________', x0 + fw * 2 + 2, y + Math.max(fh - 12, 16));
  }
}
