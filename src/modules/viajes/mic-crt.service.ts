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
  buildMicCampo40ColumnTexts,
  formatMonedaPdf,
  formatMontoPdf,
  formatPartyBlock,
  formatPropietarioCamionMicBlock,
  formatAduanaDestinoMicBlock,
  formatAduanaPartidaMicBlock,
  formatConsignatarioMicBlock,
  formatCrtCampo5EmisionBlock,
  formatCrtCampo11Block,
  formatCrtCampo18Block,
  formatCrtLugarPaisFechaBlock,
  formatMicCampo24Block,
  formatMicCampo26Block,
  formatRemolqueTransporteMicBlock,
  formatPorteadorMicBlock,
  formatPaisMic,
  MIC_CAMPO39_DECLARACION,
  CRT_CAMPO23_DECLARACION,
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
  poliza: string | null;
  vencimientoPoliza: Date | null;
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
  observaciones: string | null;
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
    permisoInternacional: string | null;
    fechaVencimientoPermiso: Date | null;
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
    select: {
      nombre: true,
      idFiscal: true,
      domicilio: true,
      pais: true,
      permisoInternacional: true,
      fechaVencimientoPermiso: true,
    },
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
          poliza: true,
          vencimientoPoliza: true,
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
      partidaPais: this.paisMicPrefill(
        this.legacyStr(legacy, 'partidaPais', 'paisPartida') ?? v.cliente?.pais,
      ),
      aduanaEspecificaPartida: this.legacyStr(
        legacy,
        'aduanaEspecificaPartida',
        'aduanaEspecifica',
        'aduanaPartidaEspecifica',
      ),
      codigoLugarOperativoPartida: this.legacyStr(
        legacy,
        'codigoLugarOperativoPartida',
        'codigoAduanero',
        'codigoAduaneroPartida',
        'codigoLugarOperativo',
        'lugarOperativoPartida',
      ),
      aduanaDestino: typeof legacy.aduanaDestino === 'string' ? legacy.aduanaDestino : (v.destino ?? ''),
      destinoPais: this.paisMicPrefill(
        this.legacyStr(legacy, 'destinoPais', 'paisDestino') ?? v.cliente?.pais,
      ),
      origenComercial:
        this.legacyStr(legacy, 'origenComercial', 'origen_comercial', 'origenMercancias') ??
        v.origen ??
        undefined,
      origenComercialPais: this.paisMicPrefill(
        this.legacyStr(legacy, 'origenComercialPais', 'paisOrigenComercial'),
      ),
      origenComercialCodigoAduanero: this.legacyStr(
        legacy,
        'origenComercialCodigoAduanero',
        'codigoAduaneroOrigen',
        'codigoOrigenComercial',
      ),
      porteadoresSucesivos: this.legacyStr(
        legacy,
        'porteadoresSucesivos',
        'porteadores_sucesivos',
        'porteadoresSucesivo',
      ),
      instruccionesFormalidadesAduana:
        this.legacyStr(
          legacy,
          'instruccionesFormalidadesAduana',
          'formalidadesAduana',
          'campo18',
          'instruccionesFormalidades',
        ) ?? 'N',
      montoFleteExterno:
        typeof legacy.montoFleteExterno === 'number'
          ? legacy.montoFleteExterno
          : typeof legacy.fleteExterno === 'number'
            ? legacy.fleteExterno
            : (v.precioTransportistaExterno ?? 0),
      monedaFleteExterno:
        legacy.monedaFleteExterno === 'USD' || legacy.monedaFleteExterno === 'ARS'
          ? legacy.monedaFleteExterno
          : v.monedaPrecioTransportistaExterno === 'USD'
            ? 'USD'
            : 'ARS',
      montoReembolsoContraEntrega:
        typeof legacy.montoReembolsoContraEntrega === 'number'
          ? legacy.montoReembolsoContraEntrega
          : typeof legacy.reembolsoContraEntrega === 'number'
            ? legacy.reembolsoContraEntrega
            : undefined,
      monedaReembolsoContraEntrega:
        legacy.monedaReembolsoContraEntrega === 'USD' ||
        legacy.monedaReembolsoContraEntrega === 'ARS'
          ? legacy.monedaReembolsoContraEntrega
          : undefined,
      declaracionesObservaciones:
        this.legacyStr(
          legacy,
          'declaracionesObservaciones',
          'declaraciones_observaciones',
          'declaracionesYObservaciones',
          'campo22',
        ) ?? (v.observaciones?.trim() ? v.observaciones.trim() : undefined),
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
      porteadorPais: this.paisMicPrefill(v.transportista?.pais),
      monedaDocumento: undefined,
    };
  }

  private resolveVehiculos(
    v: MicViajeRow,
    dto: MicCrtExportDto | undefined,
  ): { camion: MicVehiculo | null; semi: MicVehiculo | null } {
    const sorted = [...v.vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const vehicles = sorted.map((vv) => vv.vehiculo);
    const camion =
      vehicles.find((veh) => veh.tipo !== 'semirremolque') ?? vehicles[0] ?? null;
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
        poliza: semiFromViaje?.poliza ?? null,
        vencimientoPoliza: semiFromViaje?.vencimientoPoliza ?? null,
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

  /** Póliza y vencimiento: camión primero, completa con semirremolque si falta alguno. */
  private seguroDesdeVehiculos(
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ): { poliza: string | null; vencimientoPoliza: Date | null } {
    let poliza: string | null = null;
    let vencimientoPoliza: Date | null = null;
    for (const v of [camion, semi]) {
      if (!v) continue;
      if (!poliza?.trim() && v.poliza?.trim()) poliza = v.poliza;
      if (!vencimientoPoliza && v.vencimientoPoliza) vencimientoPoliza = v.vencimientoPoliza;
    }
    return { poliza, vencimientoPoliza };
  }

  private porteadorBlock(
    v: MicViajeRow,
    dto: MicCrtExportDto,
    camion: MicVehiculo | null,
    semi: MicVehiculo | null,
  ): string {
    if (!v.transportista) return '';
    const t = v.transportista;
    const seguro = this.seguroDesdeVehiculos(camion, semi);
    return formatPorteadorMicBlock({
      nombre: t.nombre,
      domicilio: dto.porteadorDomicilio ?? t.domicilio,
      pais: dto.porteadorPais ?? t.pais,
      permisoInternacional: t.permisoInternacional,
      vencimientoPermiso: t.fechaVencimientoPermiso
        ? this.fmt(t.fechaVencimientoPermiso)
        : undefined,
      poliza: seguro.poliza,
      vencimientoPoliza: seguro.vencimientoPoliza
        ? this.fmt(seguro.vencimientoPoliza)
        : undefined,
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
    opts: { bold?: boolean; valueFontSize?: number; emptyDash?: boolean } = {},
  ) {
    doc.rect(x, y, w, h).stroke();
    const numW = num.length >= 2 ? 14 : 10;
    doc.font('Helvetica-Bold').fontSize(6.5).text(num, x + 2, y + 2, { lineBreak: false });
    const labelText = label.trim();
    const labelMaxW = w - numW - 4;
    const labelY = y + 2;
    doc.font('Helvetica').fontSize(6);
    const labelH = doc.heightOfString(labelText, { width: labelMaxW });
    doc.text(labelText, x + 2 + numW, labelY, { width: labelMaxW, lineBreak: labelH > 9 });
    const valueY = labelY + labelH + 2;
    const fs = opts.valueFontSize ?? 8;
    const raw = value?.trim() ?? '';
    const display = raw || (opts.emptyDash === false ? '' : '—');
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(fs)
      .text(display, x + 3, valueY, {
        width: w - 6,
        height: Math.max(h - (valueY - y) - 2, fs + 2),
        lineBreak: true,
      });
  }

  private measureCrtFieldH(
    doc: PDFKit.PDFDocument,
    w: number,
    label: string,
    value: string,
    valueFs: number,
  ): number {
    const numColW = 14;
    doc.font('Helvetica').fontSize(6);
    const labelH = doc.heightOfString(label.trim(), { width: w - numColW - 4, lineBreak: true });
    const valueY = 2 + labelH + 2;
    doc.font('Helvetica').fontSize(valueFs);
    const valueH = doc.heightOfString(value?.trim() ? value : '—', { width: w - 6 });
    return Math.max(22, Math.ceil(valueY + valueH + 4));
  }

  /**
   * Pie CRT (campos 18–24): columna izquierda 19/20/21, derecha 18 arriba y 22 alto, abajo 23/24.
   */
  private drawCrtBloqueFirmas(
    doc: PDFKit.PDFDocument,
    x0: number,
    y: number,
    W: number,
    pageBottom: number,
    dto: MicCrtExportDto,
    fechaLine: string,
  ): void {
    const leftW = Math.round(W * 0.52);
    const rightW = W - leftW;
    const fsText = 8;
    const fsMonto = fsText;

    const campo19Label = 'Monto del flete externo / Valor do frete externo';
    const montoFleteExt =
      dto.montoFleteExterno != null && dto.montoFleteExterno > 0
        ? dto.montoFleteExterno
        : dto.flete;
    const monedaFleteExt = dto.monedaFleteExterno ?? dto.monedaFlete;
    const campo19Text =
      montoFleteExt > 0 ? formatMontoPdf(montoFleteExt, monedaFleteExt) : '';

    const campo20Label =
      'Monto de reembolso contra entrega / Valor de reembolso contra entrega';
    const montoReembolso = dto.montoReembolsoContraEntrega ?? 0;
    const monedaReembolso = dto.monedaReembolsoContraEntrega ?? dto.monedaFot;
    const campo20Text =
      montoReembolso > 0 ? formatMontoPdf(montoReembolso, monedaReembolso) : '';

    const campo18Label =
      'Instrucciones sobre formalidades de aduana / Instruções sobre formalidades aduaneiras';
    const campo18Text = formatCrtCampo18Block(dto.instruccionesFormalidadesAduana);

    const campo22Label =
      'Declaraciones y observaciones / Declarações e observações';
    const campo22Text = dto.declaracionesObservaciones?.trim() ?? '';

    const campo21Label =
      'Nombre y firma del remitente o su representante / Nome e assinatura do remitente ou seu representante';

    const h19 = this.measureCrtFieldH(doc, leftW, campo19Label, campo19Text, fsMonto);
    const h20 = this.measureCrtFieldH(doc, leftW, campo20Label, campo20Text, fsMonto);
    const h18 = this.measureCrtFieldH(doc, rightW, campo18Label, campo18Text, fsText);
    const h21 = Math.max(
      40,
      this.measureCrtFieldH(doc, leftW, campo21Label, dto.remitente.razonSocial, 6.5) + 10,
    );
    const leftStackH = h19 + h20 + h21;
    const h22 = Math.max(36, leftStackH - h18);

    this.cell(doc, x0, y, leftW, h19, '19', campo19Label, campo19Text, {
      valueFontSize: fsMonto,
      emptyDash: false,
    });
    this.cell(doc, x0 + leftW, y, rightW, h18, '18', campo18Label, campo18Text, {
      valueFontSize: fsText,
    });

    this.cell(doc, x0, y + h19, leftW, h20, '20', campo20Label, campo20Text, {
      valueFontSize: fsMonto,
      emptyDash: false,
    });
    this.cell(doc, x0 + leftW, y + h18, rightW, h22, '22', campo22Label, campo22Text, {
      valueFontSize: fsText,
      emptyDash: false,
    });

    const y21 = y + h19 + h20;
    this.cell(doc, x0, y21, leftW, h21, '21', campo21Label, '', { emptyDash: false });
    doc.font('Helvetica')
      .fontSize(6.5)
      .text(dto.remitente.razonSocial?.trim() || '', x0 + 3, y21 + 16, {
        width: leftW - 6,
        lineBreak: true,
      });
    doc.font('Helvetica')
      .fontSize(7)
      .text(fechaLine, x0 + 2, y21 + h21 - 14, { lineBreak: false });

    const sigY = y + leftStackH;
    const fh = Math.max(pageBottom - sigY, 58);
    const campo23Pad = 4;
    const campo23InnerW = leftW - campo23Pad * 2;
    const campo23Label =
      'Nombre, firma y sello del porteador y su representante / Nome, assinatura e carimbo do transportador o seu representante';

    doc.rect(x0, sigY, leftW, fh).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('23', x0 + 2, sigY + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(6).text(campo23Label, x0 + 14, sigY + 2, {
      width: leftW - 16,
      lineBreak: true,
    });
    doc.font('Helvetica').fontSize(6);
    const campo23LabelH = doc.heightOfString(campo23Label, { width: leftW - 16 });
    doc.font('Helvetica')
      .fontSize(5.5)
      .text(CRT_CAMPO23_DECLARACION, x0 + campo23Pad, sigY + 2 + campo23LabelH + 4, {
        width: campo23InnerW,
        lineBreak: true,
      });
    doc.font('Helvetica')
      .fontSize(7)
      .text(fechaLine, x0 + 2, sigY + fh - 14, { lineBreak: false });

    const dx = x0 + leftW;
    doc.rect(dx, sigY, rightW, fh).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('24', dx + 2, sigY + 2, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(6)
      .text(
        'Nombre y firma del destinatario o su representante / Nome e assinatura do destinatário ou seu representante',
        dx + 14,
        sigY + 2,
        { width: rightW - 16, lineBreak: true },
      );
    doc.font('Helvetica')
      .fontSize(7)
      .text(fechaLine, dx + 2, sigY + fh - 14, { lineBreak: false });
  }

  private paisMicPrefill(pais?: string | null): string | undefined {
    const fmt = formatPaisMic(pais);
    return fmt || undefined;
  }

  private legacyStr(legacy: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
      const v = legacy[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  }

  private aduanaPartidaBlock(dto: MicCrtExportDto): string {
    return formatAduanaPartidaMicBlock({
      ciudadLugar: dto.aduanaPartida,
      pais: dto.partidaPais,
      aduanaEspecifica: dto.aduanaEspecificaPartida,
      codigoLugarOperativo: dto.codigoLugarOperativoPartida,
    });
  }

  private aduanaDestinoBlock(dto: MicCrtExportDto): string {
    return formatAduanaDestinoMicBlock({
      ciudadLugar: dto.aduanaDestino,
      pais: dto.destinoPais ?? dto.destinatario?.pais,
    });
  }

  private propietarioCamionBlock(v: MicViajeRow, dto: MicCrtExportDto): string {
    const t = v.transportista;
    if (!t) return '';
    return formatPropietarioCamionMicBlock({
      nombre: t.nombre,
      domicilio: dto.porteadorDomicilio ?? t.domicilio,
      pais: dto.porteadorPais ?? t.pais,
    });
  }

  private remolqueTransporteBlock(semi: MicVehiculo | null, dto: MicCrtExportDto): string {
    return formatRemolqueTransporteMicBlock({
      patente: dto.semirremolque?.patente ?? semi?.patente,
      marca: dto.semirremolque?.marca ?? semi?.marca,
      modelo: semi?.modelo,
      nroChasis: semi?.nroChasis,
    });
  }

  private micCampo24Block(dto: MicCrtExportDto): string {
    return formatMicCampo24Block({
      aduanaEspecifica: dto.aduanaEspecificaPartida,
      codigoAduanero: dto.codigoLugarOperativoPartida,
    });
  }

  private micCampo26Block(dto: MicCrtExportDto): string {
    return formatMicCampo26Block({
      origenComercial: dto.origenComercial,
      pais: dto.origenComercialPais ?? dto.partidaPais,
      codigoAduanero:
        dto.origenComercialCodigoAduanero ?? dto.codigoLugarOperativoPartida,
    });
  }

  /** Campo 40 — tres columnas (ruta | plazos | conductores); separadores finos. */
  private drawMicCampo40(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    columns: string[],
  ): number {
    const title = 'N° DTA, ruta y plazo de transporte';
    const fsTitle = 6;
    const fsVal = 7.5;
    const pad = 4;

    const colWs = [
      Math.round(w * 0.4),
      Math.round(w * 0.32),
      w - Math.round(w * 0.4) - Math.round(w * 0.32),
    ];

    doc.font('Helvetica').fontSize(fsTitle);
    const titleH = doc.heightOfString(title, { width: w - 20 });
    const headerH = titleH + 6;

    doc.font('Helvetica').fontSize(fsVal);
    let maxContentH = 0;
    for (let i = 0; i < columns.length; i++) {
      const innerW = colWs[i] - pad * 2;
      const text = columns[i]?.trim() || '—';
      maxContentH = Math.max(maxContentH, doc.heightOfString(text, { width: innerW }));
    }

    const h = Math.max(48, Math.ceil(headerH + maxContentH + pad + 4));

    doc.rect(x, y, w, h).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('40', x + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(fsTitle)
      .text(title, x + 16, y + 2, { width: w - 18, lineBreak: true });

    const contentY = y + headerH;
    let cx = x;
    for (let i = 0; i < columns.length; i++) {
      const colW = colWs[i];
      if (i > 0) {
        doc.save();
        doc.lineWidth(0.25).strokeColor('#bbbbbb');
        doc.moveTo(cx, contentY + 1).lineTo(cx, y + h - 1).stroke();
        doc.restore();
      }
      doc.font('Helvetica')
        .fontSize(fsVal)
        .fillColor('#000000')
        .text(columns[i]?.trim() || '—', cx + pad, contentY + 2, {
          width: colW - pad * 2,
          lineBreak: true,
        });
      cx += colW;
    }

    return h;
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
    const valueFs = 7.5;
    const rowFs = 7;
    const porteadorFs = valueFs;
    const porteadorText = this.porteadorBlock(v, dto, camion, semi);
    doc.font('Helvetica').fontSize(porteadorFs);
    const porteadorValueH = doc.heightOfString(porteadorText.trim() ? porteadorText : '—', {
      width: col1w - 6,
    });
    const f1h = Math.max(62, Math.ceil(18 + porteadorValueH + 6));

    this.cell(doc, x0, y, col1w, f1h, '1', 'Nombre y domicilio del porteador', porteadorText, {
      valueFontSize: porteadorFs,
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

    const partidaText = this.aduanaPartidaBlock(dto);
    doc.font('Helvetica').fontSize(rowFs);
    const partidaValueH = doc.heightOfString(partidaText.trim() ? partidaText : '—', {
      width: W - 6,
    });
    const aduanaPartidaRowH = Math.max(28, Math.ceil(18 + partidaValueH + 4));
    this.cell(
      doc,
      x0,
      y,
      W,
      aduanaPartidaRowH,
      '7',
      'Aduana, ciudad y país de partida / Alfândega, cidade e país de partida',
      partidaText,
      { valueFontSize: rowFs },
    );
    y += aduanaPartidaRowH;

    const destinoText = this.aduanaDestinoBlock(dto);
    doc.font('Helvetica').fontSize(rowFs);
    const destinoValueH = doc.heightOfString(destinoText.trim() ? destinoText : '—', {
      width: W - 6,
    });
    const aduanaDestinoRowH = Math.max(24, Math.ceil(18 + destinoValueH + 4));
    this.cell(
      doc,
      x0,
      y,
      W,
      aduanaDestinoRowH,
      '8',
      'Ciudad y país de destino final / Cidade e país de destino final',
      destinoText,
      { valueFontSize: rowFs },
    );
    y += aduanaDestinoRowH;

    // 13 = remolque (ancho), 15 = capacidad (angosto, una línea).
    const c15w = 54;
    const c14w = Math.round(W * 0.05);
    const c13w = Math.round(W * 0.19);
    const c12w = Math.round(W * 0.14);
    const c11w = Math.round(W * 0.08);
    /** Campo 10 — CUIT/Rol; ancho mínimo legible (evita compresión horizontal). */
    const c10w = Math.max(Math.round(W * 0.12), 68);
    const c9w = W - c10w - c11w - c12w - c13w - c14w - c15w;

    const remolqueFs = rowFs;
    const campo15Fs = rowFs;
    const campo10Fs = rowFs;
    const rolContribuyente = v.transportista?.idFiscal?.trim() ?? '';
    const propietarioText = this.propietarioCamionBlock(v, dto);
    const remolqueText = this.remolqueTransporteBlock(semi, dto);
    const semiExtra =
      dto.semirremolque?.capacidadArrastreT != null
        ? `${dto.semirremolque.capacidadArrastreT} t`
        : '';
    const remolqueLabel = 'Remolque / Reboque';
    doc.font('Helvetica').fontSize(6);
    const remolqueLabelH = doc.heightOfString(remolqueLabel, { width: c13w - 18 });
    doc.font('Helvetica').fontSize(rowFs);
    const propietarioValueH = doc.heightOfString(propietarioText.trim() ? propietarioText : '—', {
      width: c9w - 6,
    });
    doc.fontSize(remolqueFs);
    const remolqueValueH = doc.heightOfString(remolqueText, { width: c13w - 6 });
    doc.fontSize(campo10Fs);
    const rolContribuyenteH = doc.heightOfString(rolContribuyente || '—', { width: c10w - 6 });
    const f5h = Math.max(
      34,
      Math.ceil(14 + propietarioValueH + 4),
      Math.ceil(14 + remolqueLabelH + 2 + remolqueValueH + 4),
      Math.ceil(14 + rolContribuyenteH + 4),
    );

    this.cell(doc, x0, y, c9w, f5h, '9', 'Camión original — Propietario', propietarioText, {
      valueFontSize: rowFs,
    });
    this.cell(doc, x0 + c9w, y, c10w, f5h, '10', 'Rol contribuyente', rolContribuyente, {
      valueFontSize: campo10Fs,
    });
    this.cell(doc, x0 + c9w + c10w, y, c11w, f5h, '11', 'Placa del camión', camion?.patente ?? '');
    const marcaNum = formatMarcaNumeroPdf(camion);
    this.cell(doc, x0 + c9w + c10w + c11w, y, c12w, f5h, '12', 'Marca y número / Marca e número', marcaNum);
    this.cell(
      doc,
      x0 + c9w + c10w + c11w + c12w,
      y,
      c13w,
      f5h,
      '13',
      remolqueLabel,
      remolqueText,
      { valueFontSize: remolqueFs },
    );
    this.cell(
      doc,
      x0 + c9w + c10w + c11w + c12w + c13w,
      y,
      c14w,
      f5h,
      '14',
      'Año / Ano',
      camion?.anio ? String(camion.anio) : '',
    );
    this.cell(
      doc,
      x0 + c9w + c10w + c11w + c12w + c13w + c14w,
      y,
      c15w,
      f5h,
      '15',
      'Capacidad / Capacidade',
      semiExtra || '—',
      { valueFontSize: campo15Fs },
    );
    y += f5h;

    const c23w = Math.round(W * 0.3);
    const c24w = Math.round(W * 0.28);
    const c25w = Math.round(W * 0.12);
    const c26w = W - c23w - c24w - c25w;

    const campo24Fs = 8;
    const campo24Text = this.micCampo24Block(dto);
    const campo26Fs = 8;
    const campo26Text = this.micCampo26Block(dto);
    doc.font('Helvetica').fontSize(campo24Fs);
    const campo24H = doc.heightOfString(campo24Text, { width: c24w - 6 });
    doc.fontSize(campo26Fs);
    const campo26H = doc.heightOfString(campo26Text, { width: c26w - 6 });
    const f6h = Math.max(
      22,
      Math.ceil(18 + campo24H + 4),
      Math.ceil(18 + campo26H + 4),
    );

    this.cell(doc, x0, y, c23w, f6h, '23', 'N° Carta de porte', dto.cartaPorte ?? dto.crtNumero);
    this.cell(
      doc,
      x0 + c23w,
      y,
      c24w,
      f6h,
      '24',
      'Aduana específica / Código aduanero',
      campo24Text,
      { valueFontSize: campo24Fs },
    );
    this.cell(doc, x0 + c23w + c24w, y, c25w, f6h, '25', 'Moneda', this.monedaDoc(dto));
    this.cell(
      doc,
      x0 + c23w + c24w + c25w,
      y,
      c26w,
      f6h,
      '26',
      'Origen comercial / País y código aduanero',
      campo26Text,
      { valueFontSize: campo26Fs },
    );
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
    this.cell(
      doc,
      x0,
      y,
      halfW,
      f9h,
      '33',
      'Remitente / Remetente',
      formatPartyBlock(dto.remitente, { includeIdFiscal: false }),
    );
    this.cell(
      doc,
      x0 + halfW,
      y,
      W - halfW,
      f9h,
      '34',
      'Destinatario',
      formatPartyBlock(dto.destinatario, { includeIdFiscal: false }),
    );
    y += f9h;
    const consignatarioFs = 7;
    const consignatarioText = formatConsignatarioMicBlock(dto.consignatario);
    doc.font('Helvetica').fontSize(consignatarioFs);
    const consignatarioH = doc.heightOfString(
      consignatarioText.trim() ? consignatarioText : '—',
      { width: W - 6 },
    );
    const f35h = Math.max(30, Math.ceil(18 + consignatarioH + 4));
    this.cell(doc, x0, y, W, f35h, '35', 'Consignatario', consignatarioText, {
      valueFontSize: consignatarioFs,
    });
    y += f35h;

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

    const campo40Cols = buildMicCampo40ColumnTexts(dto.ruta);
    const f40h = this.drawMicCampo40(doc, x0, y, W, campo40Cols);
    y += f40h;

    const remainH = Math.max(841 - M - y, 30);
    const fechaData = `Fecha / Data: ${this.fmt(dto.fechaEmision)}`;
    const campo39Pad = 4;
    const campo39InnerW = halfW - campo39Pad * 2;
    const campo39Label =
      'Firma y sello del porteador / Assinatura e carimbo do transportador';
    const campo39DeclFs = 5.5;
    const campo39FechaFs = 7;

    doc.font('Helvetica').fontSize(campo39DeclFs);
    const campo39DeclH = doc.heightOfString(MIC_CAMPO39_DECLARACION, {
      width: campo39InnerW,
    });

    doc.rect(x0, y, halfW, remainH).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5).text('39', x0 + 2, y + 2, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(6)
      .text(` ${campo39Label}`, x0 + 10, y + 2, {
        width: halfW - 12,
        lineBreak: true,
      });
    doc.font('Helvetica')
      .fontSize(campo39DeclFs)
      .text(MIC_CAMPO39_DECLARACION, x0 + campo39Pad, y + 16, {
        width: campo39InnerW,
        height: Math.max(remainH - 30, campo39DeclH),
        lineBreak: true,
      });
    doc.font('Helvetica')
      .fontSize(campo39FechaFs)
      .text(fechaData, x0 + campo39Pad, y + remainH - 12);

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
    const valueFs = 8;
    const porteadorCrt = v.transportista
      ? formatPropietarioCamionMicBlock({
          nombre: v.transportista.nombre,
          domicilio: dto.porteadorDomicilio ?? v.transportista.domicilio,
          pais: dto.porteadorPais ?? v.transportista.pais,
        })
      : '';
    const notificar = formatConsignatarioMicBlock(dto.notificarA ?? dto.consignatario);
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
      valueFontSize: valueFs,
    });
    y += 38;

    const row3Fs = 7.5;
    doc.font('Helvetica').fontSize(row3Fs);
    const porteadorCrtH = doc.heightOfString(porteadorCrt.trim() ? porteadorCrt : '—', {
      width: halfW - 6,
    });
    const campo5Text = formatCrtCampo5EmisionBlock({
      lugar: dto.aduanaPartida,
      pais: dto.partidaPais,
      codigoAduanero: dto.codigoLugarOperativoPartida,
    });
    const campo5H = doc.heightOfString(campo5Text.trim() ? campo5Text : '—', {
      width: W - halfW - 6,
    });
    const row3h = Math.max(34, Math.ceil(18 + Math.max(porteadorCrtH, campo5H) + 4));

    this.cell(doc, x0, y, halfW, row3h, '3', 'Nombre y domicilio del porteador', porteadorCrt, {
      valueFontSize: row3Fs,
    });
    this.cell(doc, x0 + halfW, y, W - halfW, row3h, '5', 'Lugar y país de emisión', campo5Text, {
      valueFontSize: row3Fs,
    });
    y += row3h;

    const campo7Text = formatCrtLugarPaisFechaBlock({
      lugar: v.origen,
      pais: dto.partidaPais,
      fecha: this.fmt(v.fechaCarga ?? dto.fechaEmision),
    });
    const destinatarioText = formatPartyBlock(dto.destinatario, { includeIdFiscal: false });
    doc.font('Helvetica').fontSize(row3Fs);
    const destinatarioH = doc.heightOfString(destinatarioText.trim() ? destinatarioText : '—', {
      width: halfW - 6,
    });
    const campo7H = doc.heightOfString(campo7Text.trim() ? campo7Text : '—', {
      width: W - halfW - 6,
    });
    const row4h = Math.max(34, Math.ceil(18 + Math.max(destinatarioH, campo7H) + 4));

    this.cell(
      doc,
      x0,
      y,
      halfW,
      row4h,
      '4',
      'Nombre y domicilio del destinatario',
      destinatarioText,
      { valueFontSize: row3Fs },
    );
    this.cell(
      doc,
      x0 + halfW,
      y,
      W - halfW,
      row4h,
      '7',
      'Lugar, país y fecha en que el porteador se hace cargo de las mercancías',
      campo7Text,
      { valueFontSize: row3Fs },
    );
    y += row4h;

    const campo8Text = formatCrtLugarPaisFechaBlock({
      lugar: v.destino ?? dto.aduanaDestino,
      pais: dto.destinoPais ?? dto.destinatario?.pais,
      fecha: this.fmt(v.fechaDescarga),
    });
    const consignatarioText = formatPartyBlock(dto.consignatario);
    const consignatarioH = doc.heightOfString(consignatarioText.trim() ? consignatarioText : '—', {
      width: halfW - 6,
    });
    const campo8H = doc.heightOfString(campo8Text.trim() ? campo8Text : '—', {
      width: W - halfW - 6,
    });
    const row5h = Math.max(34, Math.ceil(18 + Math.max(consignatarioH, campo8H) + 4));

    this.cell(doc, x0, y, halfW, row5h, '6', 'Nombre y domicilio del consignatario', consignatarioText, {
      valueFontSize: row3Fs,
    });
    this.cell(
      doc,
      x0 + halfW,
      y,
      W - halfW,
      row5h,
      '8',
      'Lugar, país y plazo de entrega',
      campo8Text,
      { valueFontSize: row3Fs },
    );
    y += row5h;

    doc.font('Helvetica').fontSize(row3Fs);
    const notificarH = doc.heightOfString(notificar.trim() ? notificar : '—', {
      width: halfW - 6,
    });
    const porteadoresSucesivos = dto.porteadoresSucesivos?.trim() ?? '';
    const porteadoresSucesivosH = doc.heightOfString(porteadoresSucesivos || '—', {
      width: W - halfW - 6,
    });
    const row6h = Math.max(28, Math.ceil(18 + Math.max(notificarH, porteadoresSucesivosH) + 4));

    this.cell(doc, x0, y, halfW, row6h, '9', 'Notificar a', notificar, {
      valueFontSize: row3Fs,
    });
    this.cell(doc, x0 + halfW, y, W - halfW, row6h, '10', 'Porteadores sucesivos', porteadoresSucesivos);
    y += row6h;

    const c11w = Math.round(W * 0.55);
    const c12w = Math.round(W * 0.22);
    const c13w = W - c11w - c12w;
    const mercanciasCrt = formatCrtCampo11Block(dto);
    doc.font('Helvetica').fontSize(8);
    const mercanciasH = doc.heightOfString(mercanciasCrt.trim() ? mercanciasCrt : '—', {
      width: c11w - 6,
    });
    const row7h = Math.max(65, Math.ceil(18 + mercanciasH + 4));

    this.cell(
      doc,
      x0,
      y,
      c11w,
      row7h,
      '11',
      'Cantidad y clase de bultos, marcas y números, tipo de mercancías',
      mercanciasCrt,
      { valueFontSize: 8 },
    );
    const pesoCrt = dto.pesoBrutoKg > 0 ? dto.pesoBrutoKg.toLocaleString('es-AR') : '';
    this.cell(doc, x0 + c11w, y, c12w, row7h, '12', 'Peso bruto (kg.)', pesoCrt);
    this.cell(
      doc,
      x0 + c11w + c12w,
      y,
      c13w,
      row7h,
      '13',
      'Volumen m³',
      dto.volumenM3 != null ? String(dto.volumenM3) : '',
    );
    y += row7h;

    const c14w = Math.round(W * 0.32);
    const valorLetras = montoEnLetras(dto.valorFot, dto.monedaFot);
    doc.font('Helvetica').fontSize(8);
    const valorLetrasH = doc.heightOfString(valorLetras.trim() ? valorLetras : '—', {
      width: W - c14w - 6,
    });
    const row8h = Math.max(35, Math.ceil(18 + valorLetrasH + 4));

    this.cell(doc, x0, y, c14w, row8h, '14', 'Valor / Valor', formatMontoPdf(dto.valorFot, dto.monedaFot), {
      valueFontSize: valueFs,
    });
    this.cell(
      doc,
      x0 + c14w,
      y,
      W - c14w,
      row8h,
      '16',
      'Declaración del valor de las mercancías',
      valorLetras,
      { valueFontSize: 8 },
    );
    y += row8h;

    const gastosW = Math.round(W * 0.44);
    const docAnexosW = W - gastosW;
    const docAnexosLabel = 'Documentos anexos';
    const docAnexosFs = 8;
    const docAnexosNumW = 14;
    doc.font('Helvetica').fontSize(6);
    const docAnexosLabelH = doc.heightOfString(docAnexosLabel, {
      width: docAnexosW - docAnexosNumW - 4,
    });
    doc.font('Helvetica').fontSize(docAnexosFs);
    const docAnexosText = dto.documentosAnexos?.trim() ?? '';
    const docAnexosValueH = doc.heightOfString(docAnexosText ? docAnexosText : '—', {
      width: docAnexosW - 6,
    });
    const gastosH = Math.max(
      60,
      Math.ceil(2 + docAnexosLabelH + 2 + docAnexosValueH + 4),
    );
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
    const gRem = x0 + Math.round(gastosW * 0.36);
    const gDest = x0 + Math.round(gastosW * 0.58);
    const gMon = x0 + Math.round(gastosW * 0.80);
    const hdrY = y + 12;
    doc.font('Helvetica-Bold')
      .fontSize(5.5)
      .text('Concepto', x0 + 2, hdrY)
      .text('Remitente', gRem, hdrY)
      .text('Destinatario', gDest, hdrY)
      .text('Moneda', gMon, hdrY);
    const row1 = y + 22;
    const row2 = y + 34;
    const row3 = y + 46;
    doc.font('Helvetica')
      .fontSize(7)
      .text('Flete / Frete', x0 + 2, row1)
      .text(fleteOrigen, gRem, row1)
      .text(fleteDestino, gDest, row1)
      .text(monFlete, gMon, row1)
      .text('Seguro / Seguro', x0 + 2, row2)
      .text(seguroOrigen, gRem, row2)
      .text(seguroDestino, gDest, row2)
      .font('Helvetica-Bold')
      .text('TOTAL', x0 + 2, row3)
      .font('Helvetica')
      .text(totalOrigen, gRem, row3)
      .text(totalDestino, gDest, row3)
      .text(monFlete, gMon, row3);

    this.cell(
      doc,
      x0 + gastosW,
      y,
      docAnexosW,
      gastosH,
      '17',
      docAnexosLabel,
      docAnexosText,
      { valueFontSize: docAnexosFs },
    );
    y += gastosH;

    this.drawCrtBloqueFirmas(doc, x0, y, W, 841 - M, dto, fechaLine);
  }
}
