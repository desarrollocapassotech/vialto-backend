import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: new (opts?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument = require('pdfkit');
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  MIC_CRT_TIPOS_BULTOS,
  MicCrtActorDto,
  MicCrtExportDto,
} from './dto/mic-crt-export.dto';
import {
  descripcionMercanciasPdf,
  formatMarcaNumeroPdf,
  formatMicCampo40Pdf,
  formatMonedaPdf,
  formatMontoPdf,
  formatPartyBlock,
  formatPorteadorCrtLine,
  formatPorteadorMicBlock,
  montoEnLetras,
  partyFromEntity,
  readStoredMicCrtExport,
  todayIsoDateLocal,
} from './mic-crt-export.util';

type MissingGroup = { fields: string[]; entityId?: string };

type MicVehiculo = {
  patente: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  nroChasis: string | null;
  tara: number | null;
  precinto: string | null;
};

type MicViajeRow = {
  id: string;
  numero: string;
  origen: string | null;
  destino: string | null;
  fechaCarga: Date | null;
  fechaDescarga: Date | null;
  documentoAduanero: unknown;
  monedaPrecioTransportistaExterno: string;
  precioTransportistaExterno: number | null;
  cliente: {
    nombre: string;
    idFiscal: string | null;
    direccion: string | null;
    pais: string | null;
  } | null;
  transportista: {
    nombre: string;
    idFiscal: string | null;
    domicilio: string | null;
    pais: string | null;
  } | null;
  chofer: { id: string; nombre: string; dni: string | null; licencia: string | null } | null;
  vehiculosViaje: Array<{ orden: number; vehiculo: MicVehiculo }>;
};

export type MicCrtPrefillResponse = {
  viajeId: string;
  viajeNumero: string;
  tiposBultos: readonly string[];
  /** Datos sugeridos para el modal (completar antes de POST). */
  prefill: MicCrtExportDto;
  operativo: {
    origen: string | null;
    destino: string | null;
    clienteNombre: string | null;
    transportistaNombre: string | null;
    placaCamion: string | null;
    conductorNombre: string | null;
  };
};

const VIAJE_INCLUDE = {
  cliente: { select: { nombre: true, idFiscal: true, direccion: true, pais: true } },
  transportista: {
    select: { nombre: true, idFiscal: true, domicilio: true, pais: true },
  },
  chofer: { select: { id: true, nombre: true, dni: true, licencia: true } },
  vehiculosViaje: {
    orderBy: { orden: 'asc' as const },
    include: {
      vehiculo: {
        select: {
          patente: true,
          tipo: true,
          marca: true,
          modelo: true,
          anio: true,
          nroChasis: true,
          tara: true,
          precinto: true,
        },
      },
    },
  },
};

const EMPTY_ACTOR: MicCrtActorDto = {
  razonSocial: '',
  idFiscal: '',
  calle: '',
  numero: '',
  ciudad: '',
  pais: '',
};

@Injectable()
export class MicCrtService {
  constructor(private readonly prisma: PrismaService) {}

  async getPrefill(viajeId: string, tenantId: string): Promise<MicCrtPrefillResponse> {
    const viaje = await this.loadViaje(viajeId, tenantId);
    const sorted = [...viaje.vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const camion = sorted[0]?.vehiculo ?? null;
    return {
      viajeId: viaje.id,
      viajeNumero: viaje.numero,
      tiposBultos: MIC_CRT_TIPOS_BULTOS,
      prefill: this.buildPrefill(viaje),
      operativo: {
        origen: viaje.origen,
        destino: viaje.destino,
        clienteNombre: viaje.cliente?.nombre ?? null,
        transportistaNombre: viaje.transportista?.nombre ?? null,
        placaCamion: camion?.patente ?? null,
        conductorNombre: viaje.chofer?.nombre ?? null,
      },
    };
  }

  /** Genera PDF MIC/CRT con datos del formulario aduanero (POST desde modal). */
  async generate(viajeId: string, tenantId: string, dto: MicCrtExportDto): Promise<Buffer> {
    const viaje = await this.loadViaje(viajeId, tenantId);
    this.assertOperationalReady(viaje);
    await this.persistExport(viajeId, tenantId, dto);
    const { camion, semi } = this.resolveVehiculos(viaje, dto);
    return this.buildPdf(viaje, dto, camion, semi);
  }

  private async loadViaje(viajeId: string, tenantId: string): Promise<MicViajeRow> {
    const viaje = (await this.prisma.viaje.findFirst({
      where: { id: viajeId, tenantId },
      include: VIAJE_INCLUDE,
    })) as MicViajeRow | null;
    if (!viaje) throw new NotFoundException('Viaje no encontrado');
    return viaje;
  }

  private actorFromParty(p: ReturnType<typeof partyFromEntity>): MicCrtActorDto {
    return {
      razonSocial: p.razonSocial ?? '',
      idFiscal: p.idFiscal ?? '',
      calle: p.calle ?? '',
      numero: p.numero ?? '',
      ciudad: p.ciudad ?? '',
      pais: p.pais ?? '',
    };
  }

  private buildPrefill(v: MicViajeRow): MicCrtExportDto {
    const stored = readStoredMicCrtExport(v.documentoAduanero);
    if (stored) {
      return { ...stored, fechaEmision: todayIsoDateLocal() };
    }

    const legacy = (v.documentoAduanero ?? {}) as Record<string, unknown>;
    const { semi } = this.resolveVehiculos(v, undefined);
    const tipoLegacy =
      typeof legacy.tipoBultos === 'string' &&
      (MIC_CRT_TIPOS_BULTOS as readonly string[]).includes(legacy.tipoBultos)
        ? legacy.tipoBultos
        : 'PALETA';

    return {
      micNumero: typeof legacy.mic === 'string' ? legacy.mic : '',
      crtNumero: typeof legacy.crt === 'string' ? legacy.crt : '',
      fechaEmision: todayIsoDateLocal(),
      remitente: { ...EMPTY_ACTOR },
      destinatario: v.cliente
        ? this.actorFromParty(
            partyFromEntity({
              nombre: v.cliente.nombre,
              idFiscal: v.cliente.idFiscal,
              direccion: v.cliente.direccion,
              pais: v.cliente.pais,
            }),
          )
        : { ...EMPTY_ACTOR },
      consignatario: { ...EMPTY_ACTOR },
      ncm: '',
      bultos: typeof legacy.bultos === 'number' ? legacy.bultos : 0,
      tipoBultos: tipoLegacy,
      pesoBrutoKg: typeof legacy.kgCarga === 'number' ? legacy.kgCarga : 0,
      volumenM3: undefined,
      valorFot: 0,
      monedaFot: 'USD',
      flete: v.precioTransportistaExterno ?? 0,
      monedaFlete: v.monedaPrecioTransportistaExterno === 'USD' ? 'USD' : 'ARS',
      seguroUsd: typeof legacy.seguroUsd === 'number' ? legacy.seguroUsd : undefined,
      condicionPago: 'destino',
      aduanaPartida: v.origen ?? '',
      aduanaDestino: typeof legacy.aduanaDestino === 'string' ? legacy.aduanaDestino : (v.destino ?? ''),
      documentosAnexos: '',
      precintos: typeof legacy.precintos === 'string' ? legacy.precintos : (semi?.precinto ?? ''),
      cartaPorte: typeof legacy.crt === 'string' ? legacy.crt : '',
      ruta: typeof legacy.ruta === 'string' ? legacy.ruta : undefined,
      descripcionMercaderias: '',
      semirremolque: semi
        ? {
            patente: semi.patente,
            marca: semi.marca ?? undefined,
            anio: semi.anio ?? undefined,
            capacidadArrastreT: semi.tara != null ? semi.tara / 1000 : undefined,
          }
        : undefined,
      porteadorDomicilio: v.transportista?.domicilio ?? undefined,
      porteadorPais: v.transportista?.pais ?? undefined,
      monedaDocumento: undefined,
    };
  }

  private resolveVehiculos(
    v: MicViajeRow,
    dto: MicCrtExportDto | undefined,
  ): { camion: MicVehiculo | null; semi: MicVehiculo | null } {
    const sorted = [...v.vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const camion = sorted[0]?.vehiculo ?? null;
    const semiFromViaje =
      sorted.length > 1
        ? (sorted.slice(1).find((vv) => vv.vehiculo.tipo === 'semirremolque')?.vehiculo ??
          sorted[1]?.vehiculo ??
          null)
        : null;

    const s = dto?.semirremolque;
    if (!s?.patente && !semiFromViaje) return { camion, semi: null };

    return {
      camion,
      semi: {
        patente: s?.patente ?? semiFromViaje?.patente ?? '',
        tipo: 'semirremolque',
        marca: s?.marca ?? semiFromViaje?.marca ?? null,
        modelo: semiFromViaje?.modelo ?? null,
        anio: s?.anio ?? semiFromViaje?.anio ?? null,
        nroChasis: semiFromViaje?.nroChasis ?? null,
        tara:
          s?.capacidadArrastreT != null
            ? s.capacidadArrastreT * 1000
            : (semiFromViaje?.tara ?? null),
        precinto: semiFromViaje?.precinto ?? null,
      },
    };
  }

  private assertOperationalReady(v: MicViajeRow): void {
    const missingGroups: Record<string, MissingGroup> = {};
    const viajeFields: string[] = [];
    if (!v.origen?.trim()) viajeFields.push('Origen');
    if (!v.destino?.trim()) viajeFields.push('Destino');
    if (!v.transportista) viajeFields.push('Transportista (porteador)');
    if (!v.chofer) viajeFields.push('Chofer asignado');
    if (v.vehiculosViaje.length === 0) viajeFields.push('Vehículo asignado');
    if (viajeFields.length > 0) missingGroups['Viaje'] = { fields: viajeFields, entityId: v.id };

    if (v.chofer) {
      const c: string[] = [];
      if (!v.chofer.nombre?.trim()) c.push('Nombre');
      if (!v.chofer.dni?.trim()) c.push('DNI');
      if (c.length > 0) missingGroups['Chofer'] = { fields: c, entityId: v.chofer.id };
    }

    if (Object.keys(missingGroups).length > 0) {
      throw new BadRequestException({
        message: 'Faltan datos operativos del viaje para generar el MIC/CRT',
        missingGroups,
      });
    }
  }

  private async persistExport(
    viajeId: string,
    tenantId: string,
    dto: MicCrtExportDto,
  ): Promise<void> {
    await this.prisma.viaje.update({
      where: { id: viajeId, tenantId },
      data: { documentoAduanero: dto as object },
    });
  }

  private porteadorBlock(v: MicViajeRow, dto: MicCrtExportDto): string {
    if (!v.transportista) return '';
    return formatPorteadorMicBlock({
      nombre: v.transportista.nombre,
      idFiscal: v.transportista.idFiscal,
      domicilio: dto.porteadorDomicilio ?? v.transportista.domicilio,
      pais: dto.porteadorPais ?? v.transportista.pais,
    });
  }

  private buildPdf(
    v: MicViajeRow,
    dto: MicCrtExportDto,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.drawMicDta(doc, v, dto, camion, semi);
        doc.addPage();
        this.drawCrt(doc, v, dto, camion, semi);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

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
    const numW = num.length >= 2 ? 14 : 10;
    doc.font('Helvetica-Bold').fontSize(6.5).text(num, x + 2, y + 2, { lineBreak: false });
    const labelText = label.trim();
    const labelMaxW = w - numW - 4;
    doc.font('Helvetica').fontSize(6);
    const labelH = doc.heightOfString(labelText, { width: labelMaxW });
    const valueY = labelH > 9 ? y + 15 : y + 13;
    doc.text(labelText, x + 2 + numW, y + 2, { width: labelMaxW, lineBreak: labelH > 9 });
    const fs = opts.valueFontSize ?? 8;
    const display = value?.trim() ? value : '—';
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(fs)
      .text(display, x + 3, valueY, {
        width: w - 6,
        height: h - (valueY - y) - 2,
        lineBreak: true,
      });
  }

  private fmt(d: Date | string | null | undefined): string {
    if (!d) return '';
    const dt = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00`) : d;
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  }

  private monedaDoc(dto: MicCrtExportDto): string {
    return formatMonedaPdf(dto.monedaDocumento ?? dto.monedaFot);
  }

  private drawMicDta(
    doc: PDFKit.PDFDocument,
    v: MicViajeRow,
    dto: MicCrtExportDto,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ) {
    const M = 20;
    const W = 555;
    const x0 = M;
    let y = M;

    const headerH = 42;
    const titleFs = 7.5;
    const micLabelW = 48;
    const titleW = W - micLabelW - 3;
    doc.rect(x0, y, W, headerH).fill('#1a1a1a');
    doc.fillColor('white');
    doc.font('Helvetica-Bold').fontSize(9).text('MIC/DTA', x0 + 3, y + 15, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(titleFs)
      .text(
        'MANIFIESTO INTERNACIONAL DE CARGA POR CARRETERA / DECLARACIÓN DE TRÁNSITO ADUANERO',
        x0 + micLabelW,
        y + 5,
        { width: titleW, align: 'center' },
      );
    doc.font('Helvetica')
      .fontSize(titleFs)
      .text(
        'Manifiesto Internacional de Carga Rodoviária / Declaração de Trânsito Aduaneiro',
        x0 + micLabelW,
        y + 22,
        { width: titleW, align: 'center' },
      );
    doc.fillColor('black');
    y += headerH;

    const col1w = Math.round(W * 0.58);
    const col2w = W - col1w;
    const f1h = 46;

    this.cell(doc, x0, y, col1w, f1h, '1', 'Nombre y domicilio del porteador', this.porteadorBlock(v, dto), {
      valueFontSize: 8,
    });

    const rx = x0 + col1w;
    doc.rect(rx, y, col2w, f1h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('3', rx + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Tránsito aduanero', rx + 10, y + 2, { lineBreak: false });
    doc.rect(rx + 3, y + 12, 6, 6).stroke();
    doc.font('Helvetica-Bold').fontSize(7).text('X', rx + 4, y + 12, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text('Sí / Sim', rx + 12, y + 13, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(6.5).text('4', rx + 2, y + 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' N°', rx + 10, y + 22, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).text(dto.micNumero, rx + 3, y + 30, {
      width: col2w - 6,
      align: 'center',
    });
    y += f1h;

    const f2h = 22;
    this.cell(
      doc,
      x0,
      y,
      col1w,
      f2h,
      '2',
      'Rol de contribuyente / Cadastro geral de contribuintes',
      v.transportista?.idFiscal ?? '',
    );
    const hojaw = Math.round(col2w * 0.35);
    this.cell(doc, x0 + col1w, y, hojaw, f2h, '5', 'Hoja / Folha', '1 / 1');
    this.cell(doc, x0 + col1w + hojaw, y, col2w - hojaw, f2h, '6', 'Fecha Emisión / Data de emissão', this.fmt(dto.fechaEmision));
    y += f2h;

    const f3h = 22;
    this.cell(doc, x0, y, W, f3h, '7', 'Aduana, ciudad y país de partida / Alfândega, cidade e país de partida', dto.aduanaPartida, {
      valueFontSize: 9,
      bold: true,
    });
    y += f3h;
    this.cell(doc, x0, y, W, f3h, '8', 'Ciudad y país de destino final / Cidade e país de destino final', dto.aduanaDestino, {
      valueFontSize: 9,
      bold: true,
    });
    y += f3h;

    const f5h = 40;
    const c9w = Math.round(W * 0.28);
    const c10w = Math.round(W * 0.14);
    const c11w = Math.round(W * 0.14);
    const c12w = Math.round(W * 0.24);
    const c14w = Math.round(W * 0.1);
    const c15w = W - c9w - c10w - c11w - c12w - c14w;

    this.cell(doc, x0, y, c9w, f5h, '9', 'Camión original — Propietario', v.transportista?.nombre ?? '');
    this.cell(doc, x0 + c9w, y, c10w, f5h, '10', 'Rol contribuyente', v.transportista?.idFiscal ?? '');
    this.cell(doc, x0 + c9w + c10w, y, c11w, f5h, '11', 'Placa del camión', camion?.patente ?? '');
    const marcaNum = formatMarcaNumeroPdf(camion);
    this.cell(doc, x0 + c9w + c10w + c11w, y, c12w, f5h, '12', 'Marca y número / Marca e número', marcaNum);
    this.cell(
      doc,
      x0 + c9w + c10w + c11w + c12w,
      y,
      c14w,
      f5h,
      '14',
      'Año / Ano',
      camion?.anio ? String(camion.anio) : '',
    );
    const semiInfo = semi
      ? [
          dto.semirremolque?.capacidadArrastreT != null
            ? `Cap: ${dto.semirremolque.capacidadArrastreT} t`
            : '',
          `SR ${semi.patente}`,
          semi.marca ?? '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
    this.cell(doc, x0 + c9w + c10w + c11w + c12w + c14w, y, c15w, f5h, '15', 'Semi/Rem.', semiInfo);
    y += f5h;

    const f6h = 22;
    const c23w = Math.round(W * 0.3);
    const c24w = Math.round(W * 0.28);
    const c25w = Math.round(W * 0.12);
    const c26w = W - c23w - c24w - c25w;

    this.cell(doc, x0, y, c23w, f6h, '23', 'N° Carta de porte', dto.cartaPorte ?? dto.crtNumero);
    this.cell(doc, x0 + c23w, y, c24w, f6h, '24', 'Aduana de destino', dto.aduanaDestino);
    this.cell(doc, x0 + c23w + c24w, y, c25w, f6h, '25', 'Moneda', this.monedaDoc(dto));
    this.cell(doc, x0 + c23w + c24w + c25w, y, c26w, f6h, '26', 'Origen mercancías', v.origen ?? '');
    y += f6h;

    const f7h = 22;
    const c27w = Math.round(W * 0.32);
    const c28w = Math.round(W * 0.32);
    const c29w = W - c27w - c28w;

    this.cell(doc, x0, y, c27w, f7h, '27', 'Valor FOT / Valor FOT', formatMontoPdf(dto.valorFot, dto.monedaFot));
    this.cell(doc, x0 + c27w, y, c28w, f7h, '28', 'Flete en U$S / Frete em U$S', formatMontoPdf(dto.flete, dto.monedaFlete));
    this.cell(
      doc,
      x0 + c27w + c28w,
      y,
      c29w,
      f7h,
      '29',
      'Seguro en U$S',
      dto.seguroUsd != null && dto.seguroUsd > 0 ? dto.seguroUsd.toFixed(2) : '.00',
    );
    y += f7h;

    const f8h = 22;
    const c30w = Math.round(W * 0.32);
    const c31w = Math.round(W * 0.32);
    const c32w = W - c30w - c31w;

    this.cell(doc, x0, y, c30w, f8h, '30', 'Tipo de bultos / Tipo dos volumes', dto.tipoBultos);
    this.cell(
      doc,
      x0 + c30w,
      y,
      c31w,
      f8h,
      '31',
      'Cantidad de bultos',
      dto.bultos > 0 ? String(dto.bultos) : '',
    );
    this.cell(
      doc,
      x0 + c30w + c31w,
      y,
      c32w,
      f8h,
      '32',
      'Peso bruto (kg.)',
      dto.pesoBrutoKg > 0 ? dto.pesoBrutoKg.toLocaleString('es-AR') : '',
    );
    y += f8h;

    const f9h = 50;
    const halfW = Math.round(W / 2);
    this.cell(doc, x0, y, halfW, f9h, '33', 'Remitente / Remetente', formatPartyBlock(dto.remitente));
    this.cell(doc, x0 + halfW, y, W - halfW, f9h, '34', 'Destinatario', formatPartyBlock(dto.destinatario));
    y += f9h;
    this.cell(doc, x0, y, W, 30, '35', 'Consignatario', formatPartyBlock(dto.consignatario));
    y += 30;

    const f11h = 22;
    this.cell(doc, x0, y, halfW, f11h, '36', 'Documentos Anexos', dto.documentosAnexos ?? '');
    this.cell(doc, x0 + halfW, y, W - halfW, f11h, '37', 'Número de precintos / Número dos lacres', dto.precintos ?? '');
    y += f11h;

    this.cell(
      doc,
      x0,
      y,
      W,
      55,
      '38',
      'Marcas y números de los bultos, descripción de las mercancías',
      descripcionMercanciasPdf(dto),
      { valueFontSize: 8.5 },
    );
    y += 55;

    const campo40 = formatMicCampo40Pdf({
      ruta: dto.ruta,
      fechaArribo: v.fechaDescarga,
      chofer: v.chofer,
      fmt: (d) => this.fmt(d),
    });
    this.cell(doc, x0, y, W, 42, '40', 'N° DTA, ruta y plazo de transporte', campo40);
    y += 42;

    const remainH = Math.max(841 - M - y, 30);
    const fechaData = `Fecha / Data: ${this.fmt(dto.fechaEmision)}`;
    doc.rect(x0, y, halfW, remainH).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('39', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(6)
      .text(' Firma y sello del porteador / Assinatura e carimbo do transportador', x0 + 10, y + 2, {
        width: halfW - 12,
        lineBreak: false,
      });
    doc.font('Helvetica').fontSize(7).text(fechaData, x0 + 2, y + 12);

    const aduanaX = x0 + halfW;
    const aduanaW = W - halfW;
    doc.rect(aduanaX, y, aduanaW, remainH).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('41', aduanaX + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Firma y sello de Aduana de Partida', aduanaX + 10, y + 2, {
      width: aduanaW - 12,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(7).text(fechaData, aduanaX + 2, y + 12);
  }

  private drawCrt(
    doc: PDFKit.PDFDocument,
    v: MicViajeRow,
    dto: MicCrtExportDto,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ) {
    void camion;
    void semi;

    const M = 20;
    const W = 555;
    const x0 = M;
    let y = M;

    const headerH = 42;
    const titleFs = 7.5;
    const crtLabelW = 36;
    const titleW = W - crtLabelW - 3;
    doc.rect(x0, y, W, headerH).fill('#1a1a1a');
    doc.fillColor('white');
    doc.font('Helvetica-Bold').fontSize(9).text('CRT', x0 + 3, y + 15, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(titleFs)
      .text('CARTA DE PORTE INTERNACIONAL POR CARRETERA', x0 + crtLabelW, y + 5, {
        width: titleW,
        align: 'center',
      });
    doc.font('Helvetica')
      .fontSize(titleFs)
      .text('Conhecimento de Transporte Internacional por Rodovia', x0 + crtLabelW, y + 22, {
        width: titleW,
        align: 'center',
      });
    doc.fillColor('black');
    y += headerH;

    const halfW = Math.round(W / 2);
    const porteadorCrt = v.transportista
      ? formatPorteadorCrtLine(v.transportista.nombre, v.transportista.idFiscal)
      : '';
    const notificar = formatPartyBlock(dto.notificarA ?? dto.consignatario);
    const fechaLine = 'Fecha / Data: ____________________';

    this.cell(
      doc,
      x0,
      y,
      halfW,
      38,
      '1',
      'Nombre y domicilio del remitente / Nome e endereço do remetente',
      formatPartyBlock(dto.remitente),
    );
    this.cell(doc, x0 + halfW, y, W - halfW, 38, '2', 'Número / Número', dto.crtNumero, {
      valueFontSize: 11,
      bold: true,
    });
    y += 38;

    this.cell(doc, x0, y, halfW, 34, '3', 'Nombre y domicilio del porteador', porteadorCrt);
    this.cell(doc, x0 + halfW, y, W - halfW, 34, '5', 'Lugar y país de emisión', dto.aduanaPartida);
    y += 34;

    this.cell(doc, x0, y, halfW, 34, '4', 'Nombre y domicilio del destinatario', formatPartyBlock(dto.destinatario));
    this.cell(
      doc,
      x0 + halfW,
      y,
      W - halfW,
      34,
      '7',
      'Lugar, país y fecha en que el porteador se hace cargo de las mercancías',
      `${v.origen ?? ''}   ${this.fmt(v.fechaCarga ?? dto.fechaEmision)}`,
    );
    y += 34;

    this.cell(doc, x0, y, halfW, 34, '6', 'Nombre y domicilio del consignatario', formatPartyBlock(dto.consignatario));
    this.cell(
      doc,
      x0 + halfW,
      y,
      W - halfW,
      34,
      '8',
      'Lugar, país y plazo de entrega',
      `${v.destino ?? ''}   ${this.fmt(v.fechaDescarga)}`,
    );
    y += 34;

    this.cell(doc, x0, y, halfW, 28, '9', 'Notificar a', notificar);
    this.cell(doc, x0 + halfW, y, W - halfW, 28, '10', 'Porteadores sucesivos', '');
    y += 28;

    const c11w = Math.round(W * 0.55);
    const c12w = Math.round(W * 0.22);
    const c13w = W - c11w - c12w;
    const mercanciasCrt =
      descripcionMercanciasPdf(dto) ||
      [dto.bultos > 0 ? String(dto.bultos) : '', dto.tipoBultos].filter(Boolean).join(' ');
    this.cell(
      doc,
      x0,
      y,
      c11w,
      65,
      '11',
      'Cantidad y clase de bultos, marcas y números, tipo de mercancías',
      mercanciasCrt,
      { valueFontSize: 8 },
    );
    const pesoCrt = dto.pesoBrutoKg > 0 ? dto.pesoBrutoKg.toLocaleString('es-AR') : '';
    this.cell(doc, x0 + c11w, y, c12w, 65, '12', 'Peso bruto (kg.)', pesoCrt);
    this.cell(
      doc,
      x0 + c11w + c12w,
      y,
      c13w,
      65,
      '13',
      'Volumen m³',
      dto.volumenM3 != null ? String(dto.volumenM3) : '',
    );
    y += 65;

    const c14w = Math.round(W * 0.32);
    this.cell(doc, x0, y, c14w, 35, '14', 'Valor / Valor', formatMontoPdf(dto.valorFot, dto.monedaFot), {
      valueFontSize: 10,
      bold: true,
    });
    this.cell(
      doc,
      x0 + c14w,
      y,
      W - c14w,
      35,
      '16',
      'Declaración del valor de las mercancías',
      montoEnLetras(dto.valorFot, dto.monedaFot),
    );
    y += 35;

    const gastosW = Math.round(W * 0.42);
    const gastosH = 60;
    const pagoDestino = dto.condicionPago === 'destino';
    const fleteOrigen = !pagoDestino && dto.flete > 0 ? dto.flete.toFixed(2) : '.00';
    const fleteDestino = pagoDestino && dto.flete > 0 ? dto.flete.toFixed(2) : '.00';
    const seguroOrigen = '.00';
    const seguroDestino =
      dto.seguroUsd != null && dto.seguroUsd > 0 ? dto.seguroUsd.toFixed(2) : '.00';
    const totalOrigen =
      fleteOrigen !== '.00' || seguroOrigen !== '.00'
        ? (parseFloat(fleteOrigen) + parseFloat(seguroOrigen)).toFixed(2)
        : '.00';
    const totalDestino =
      fleteDestino !== '.00' || seguroDestino !== '.00'
        ? (parseFloat(fleteDestino) + parseFloat(seguroDestino)).toFixed(2)
        : '.00';
    const monFlete = formatMonedaPdf(dto.monedaFlete);

    doc.rect(x0, y, gastosW, gastosH).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('15', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Gastos a pagar', x0 + 10, y + 2, { lineBreak: false });
    const hdrY = y + 12;
    doc.font('Helvetica-Bold')
      .fontSize(5.5)
      .text('Concepto', x0 + 2, hdrY)
      .text('Remitente', x0 + 88, hdrY)
      .text('Destinatario', x0 + 163, hdrY)
      .text('Moneda', x0 + 238, hdrY);
    const row1 = y + 22;
    const row2 = y + 34;
    const row3 = y + 46;
    doc.font('Helvetica')
      .fontSize(7)
      .text('Flete / Frete', x0 + 2, row1)
      .text(fleteOrigen, x0 + 92, row1)
      .text(fleteDestino, x0 + 167, row1)
      .text(monFlete, x0 + 242, row1)
      .text('Seguro / Seguro', x0 + 2, row2)
      .text(seguroOrigen, x0 + 92, row2)
      .text(seguroDestino, x0 + 167, row2)
      .font('Helvetica-Bold')
      .text('TOTAL', x0 + 2, row3)
      .font('Helvetica')
      .text(totalOrigen, x0 + 92, row3)
      .text(totalDestino, x0 + 167, row3)
      .text(monFlete, x0 + 242, row3);

    this.cell(doc, x0 + gastosW, y, W - gastosW, gastosH, '17', 'Documentos anexos', dto.documentosAnexos ?? '');
    y += gastosH;

    this.cell(doc, x0, y, W, 22, '18', 'Instrucciones sobre formalidades de aduana', 'N');
    y += 22;

    const fh = Math.max(841 - M - y, 72);
    const fw = Math.round(W / 3);
    const transportistaLine = porteadorCrt;

    doc.rect(x0, y, fw, fh).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('21', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Nombre y firma del remitente o su representante', x0 + 10, y + 2, {
      width: fw - 12,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(6.5).text(dto.remitente.razonSocial, x0 + 2, y + 14, { width: fw - 4 });
    doc.font('Helvetica').fontSize(7).text(fechaLine, x0 + 2, y + fh - 14);

    const cx = x0 + fw;
    doc.rect(cx, y, fw, fh).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('23', cx + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Nombre, firma y sello del porteador', cx + 10, y + 2, {
      width: fw - 12,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(6.5).text(transportistaLine, cx + 2, y + 14, { width: fw - 4 });
    doc.font('Helvetica').fontSize(7).text(fechaLine, cx + 2, y + fh - 14);

    const dx = x0 + fw * 2;
    const dw = W - fw * 2;
    doc.rect(dx, y, dw, fh).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('24', dx + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(' Nombre y firma del destinatario o su representante', dx + 10, y + 2, {
      width: dw - 12,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(6.5).text(dto.destinatario.razonSocial, dx + 2, y + 14, { width: dw - 4 });
    doc.font('Helvetica').fontSize(7).text(fechaLine, dx + 2, y + fh - 14);
  }
}
