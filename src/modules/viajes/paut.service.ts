import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: new (opts?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument = require('pdfkit');
import { PrismaService } from '../../shared/prisma/prisma.service';
import { viajePuedeExportarPaut } from './viaje-exportaciones.util';

type PautVehiculo = {
  id: string;
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

type PautViaje = {
  id: string;
  numero: string;
  transportista: {
    id: string;
    nombre: string;
    idFiscal: string | null;
    paut: string | null;
    permisoInternacional: string | null;
    fechaVencimientoPermiso: Date | null;
    domicilio: string | null;
    pais: string | null;
  } | null;
  chofer: {
    id: string;
    nombre: string;
    dni: string | null;
    cuit: string | null;
  } | null;
  vehiculosViaje: Array<{ orden: number; vehiculo: PautVehiculo }>;
};

type MissingGroup = { fields: string[]; entityId?: string };

/** Estilo alineado al diseño de referencia PAUT (azul marino, secciones, zebra). */
const PAUT = {
  navy: '#1e3a5f',
  border: '#b8c5d6',
  zebra: '#eef2f7',
  white: '#ffffff',
  text: '#1a1a1a',
  title: 14,
  section: 11,
  body: 10,
  rowMinH: 28,
  rowH: 24,
  headerH: 26,
  titleBarH: 36,
  pad: 8,
  sectionGap: 10,
} as const;

@Injectable()
export class PautService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(viajeId: string, tenantId: string): Promise<Buffer> {
    const viaje = (await this.prisma.viaje.findFirst({
      where: { id: viajeId, tenantId },
      include: {
        transportista: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            paut: true,
            permisoInternacional: true,
            fechaVencimientoPermiso: true,
            domicilio: true,
            pais: true,
          },
        },
        chofer: { select: { id: true, nombre: true, dni: true, cuit: true } },
        vehiculosViaje: {
          orderBy: { orden: 'asc' },
          include: {
            vehiculo: {
              select: {
                id: true,
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
      },
    })) as unknown as PautViaje | null;

    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    if (!viajePuedeExportarPaut({ transportistaId: viaje.transportista?.id ?? null })) {
      throw new BadRequestException({
        message:
          'El PAUT solo aplica a viajes con transportista externo (no a flota propia).',
        code: 'PAUT_NOT_APPLICABLE',
        modalidadOperacion: 'flota_propia',
      });
    }

    const missingGroups: Record<string, MissingGroup> = {};
    const viajeFields: string[] = [];

    // Transportista
    if (!viaje.transportista) {
      viajeFields.push('Transportista asignado');
    } else {
      const t: string[] = [];
      if (!viaje.transportista.idFiscal?.trim()) t.push('CUIT');
      if (!viaje.transportista.paut?.trim()) t.push('N° PAUT');
      if (!viaje.transportista.permisoInternacional?.trim()) t.push('Permiso Internacional');
      if (!viaje.transportista.fechaVencimientoPermiso) t.push('Vencimiento del Permiso Internacional');
      if (!viaje.transportista.domicilio?.trim()) t.push('Domicilio');
      if (!viaje.transportista.pais?.trim()) t.push('País');
      if (t.length > 0) missingGroups['Transportista'] = { fields: t, entityId: viaje.transportista.id };
    }

    // Vehículos — se calcula aquí para validar campos Y reutilizar en el PDF
    const { camion, semi } = this.resolvePautVehiculos(viaje.vehiculosViaje);

    if (viaje.vehiculosViaje.length === 0) {
      viajeFields.push('Vehículo asignado');
    } else {
      const checkVehiculo = (v: PautVehiculo, key: string) => {
        const f: string[] = [];
        if (!v.marca?.trim()) f.push('Marca');
        if (!v.modelo?.trim()) f.push('Modelo');
        if (v.anio == null) f.push('Año');
        if (!v.nroChasis?.trim()) f.push('N° Chasis');
        if (!v.poliza?.trim()) f.push('Póliza de seguro');
        if (!v.vencimientoPoliza) f.push('Vencimiento de póliza');
        if (v.tara == null) f.push('Tara');
        if (!v.precinto?.trim()) f.push('Precinto');
        if (f.length > 0) missingGroups[key] = { fields: f, entityId: v.id };
      };
      if (camion) checkVehiculo(camion, 'Camión');
      if (semi) checkVehiculo(semi, 'Semirremolque');
    }

    // Chofer
    if (!viaje.chofer) {
      viajeFields.push('Chofer asignado');
    } else {
      const c: string[] = [];
      if (!viaje.chofer.dni?.trim()) c.push('DNI');
      if (!viaje.chofer.cuit?.trim()) c.push('CUIT');
      if (c.length > 0) missingGroups['Chofer'] = { fields: c, entityId: viaje.chofer.id };
    }

    if (viajeFields.length > 0) missingGroups['Viaje'] = { fields: viajeFields, entityId: viajeId };

    if (Object.keys(missingGroups).length > 0) {
      throw new BadRequestException({
        message: 'Faltan datos para generar el PAUT',
        missingGroups,
      });
    }

    return this.buildPdf(viaje, camion, semi);
  }

  /** Cabeza de unidad (tractor/camión) y semirremolque por tipo, no solo por orden. */
  private resolvePautVehiculos(
    vehiculosViaje: PautViaje['vehiculosViaje'],
  ): { camion: PautVehiculo | null; semi: PautVehiculo | null } {
    const sorted = [...vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const vehicles = sorted.map((vv) => vv.vehiculo);

    const semi = vehicles.find((v) => v.tipo === 'semirremolque') ?? null;
    const cabeza =
      vehicles.find((v) => v.tipo !== 'semirremolque') ??
      vehicles.find((v) => v.id !== semi?.id) ??
      null;

    if (vehicles.length === 1) {
      if (semi) return { camion: null, semi };
      return { camion: vehicles[0], semi: null };
    }

    return {
      camion: cabeza ?? vehicles[0] ?? null,
      semi: semi ?? (cabeza ? (vehicles.find((v) => v.id !== cabeza.id) ?? null) : null),
    };
  }

  private fmtDate(d: Date | string | null | undefined): string {
    if (!d) return '';
    const dt = typeof d === 'string' ? new Date(d) : d;
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const yy = dt.getUTCFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  private buildPdf(
    v: PautViaje,
    camion: PautVehiculo | null,
    semi: PautVehiculo | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.drawPaut(doc, v, camion, semi);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private rowTextY(y: number, rowH: number, fontSize: number): number {
    return y + (rowH - fontSize) / 2;
  }

  /** Altura necesaria para label + valor apilados (con wrap). */
  private measureFieldBlockHeight(
    doc: PDFKit.PDFDocument,
    bandW: number,
    label: string,
    value: string,
  ): number {
    const fs = PAUT.body;
    const pad = PAUT.pad;
    const innerW = Math.max(1, bandW - pad * 2);
    const gap = 3;
    doc.font('Helvetica-Bold').fontSize(fs);
    const labelH = doc.heightOfString(label, { width: innerW });
    doc.font('Helvetica').fontSize(fs);
    const valueH = doc.heightOfString(value || ' ', { width: innerW });
    return Math.ceil(pad + labelH + gap + valueH + pad);
  }

  /** Etiqueta arriba, valor abajo (evita cortes en celdas angostas). */
  private drawFieldStacked(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    bandW: number,
    label: string,
    value: string,
  ) {
    const fs = PAUT.body;
    const pad = PAUT.pad;
    const innerW = Math.max(1, bandW - pad * 2);
    const gap = 3;
    let ty = y + pad;
    doc
      .fillColor(PAUT.navy)
      .font('Helvetica-Bold')
      .fontSize(fs)
      .text(label, x + pad, ty, { width: innerW, lineBreak: true });
    ty += doc.heightOfString(label, { width: innerW }) + gap;
    doc
      .fillColor(PAUT.text)
      .font('Helvetica')
      .fontSize(fs)
      .text(value, x + pad, ty, { width: innerW, lineBreak: true });
  }

  private dualInfoRowHeight(
    doc: PDFKit.PDFDocument,
    w: number,
    left: { label: string; value: string },
    right: { label: string; value: string } | null,
  ): number {
    const half = right ? w / 2 : w;
    const leftH = this.measureFieldBlockHeight(doc, half, left.label, left.value);
    if (!right) return Math.max(PAUT.rowMinH, leftH);
    const rightH = this.measureFieldBlockHeight(doc, half, right.label, right.value);
    return Math.max(PAUT.rowMinH, leftH, rightH);
  }

  /** Título de sección (azul) + línea horizontal. Devuelve la Y siguiente. */
  private drawSectionTitle(doc: PDFKit.PDFDocument, x: number, y: number, w: number, title: string): number {
    const fs = PAUT.section;
    doc.fillColor(PAUT.navy).font('Helvetica-Bold').fontSize(fs).text(title, x, y, {
      width: w,
      lineBreak: false,
    });
    const lineY = y + fs + 5;
    doc
      .moveTo(x, lineY)
      .lineTo(x + w, lineY)
      .strokeColor(PAUT.navy)
      .lineWidth(1)
      .stroke();
    return lineY + PAUT.sectionGap;
  }

  /** Fila de dos campos (permiso) con zebra y divisor central. */
  private dualInfoRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    left: { label: string; value: string },
    right: { label: string; value: string } | null,
    zebra: boolean,
  ) {
    const bg = zebra ? PAUT.zebra : PAUT.white;
    doc.rect(x, y, w, h).fillAndStroke(bg, PAUT.border);
    if (right) {
      const half = w / 2;
      doc
        .moveTo(x + half, y)
        .lineTo(x + half, y + h)
        .strokeColor(PAUT.border)
        .lineWidth(0.5)
        .stroke();
      this.drawFieldStacked(doc, x, y, half, left.label, left.value);
      this.drawFieldStacked(doc, x + half, y, half, right.label, right.value);
    } else {
      this.drawFieldStacked(doc, x, y, w, left.label, left.value);
    }
  }

  /** Fila simple label + valor (chofer). */
  private infoRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    zebra: boolean,
  ) {
    const bg = zebra ? PAUT.zebra : PAUT.white;
    doc.rect(x, y, w, h).fillAndStroke(bg, PAUT.border);
    this.drawFieldStacked(doc, x, y, w, label, value);
  }

  private vehicleRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    c0: number,
    c1: number,
    c2: number,
    h: number,
    label: string,
    val1: string,
    val2: string,
    zebra = false,
  ) {
    const fs = PAUT.body;
    const pad = PAUT.pad;
    const textY = this.rowTextY(y, h, fs);
    const bg = zebra ? PAUT.zebra : PAUT.white;
    const totalW = c0 + c1 + c2;

    doc.rect(x, y, totalW, h).fillAndStroke(bg, PAUT.border);
    doc.rect(x + c0, y, c1, h).strokeColor(PAUT.border).lineWidth(0.5).stroke();
    doc.rect(x + c0 + c1, y, c2, h).strokeColor(PAUT.border).lineWidth(0.5).stroke();

    doc
      .fillColor(PAUT.navy)
      .font('Helvetica-Bold')
      .fontSize(fs)
      .text(label, x + pad, textY, { width: c0 - pad * 2, lineBreak: false });

    doc
      .fillColor(PAUT.text)
      .font('Helvetica')
      .fontSize(fs)
      .text(val1, x + c0 + pad, textY, { width: c1 - pad * 2, lineBreak: false });

    doc
      .fillColor(PAUT.text)
      .font('Helvetica')
      .fontSize(fs)
      .text(val2, x + c0 + c1 + pad, textY, { width: c2 - pad * 2, lineBreak: false });
  }

  private drawPaut(
    doc: PDFKit.PDFDocument,
    v: PautViaje,
    camion: PautVehiculo | null,
    semi: PautVehiculo | null,
  ) {
    const M = 30;
    const W = 535;
    const x0 = M;
    let y = M;
    const ROW_H = PAUT.rowH;
    const HDR_H = PAUT.headerH;

    // ── Título principal ──────────────────────────────────────────────────────
    doc.rect(x0, y, W, PAUT.titleBarH).fill(PAUT.navy);
    doc
      .fillColor(PAUT.white)
      .font('Helvetica-Bold')
      .fontSize(PAUT.title)
      .text('PERMISO DE ACTUACIÓN DEL TRANSPORTE (PAUT)', x0, y + 11, {
        width: W,
        align: 'center',
      });
    y += PAUT.titleBarH + 16;

    // ── DATOS DEL PERMISO (dos columnas) ──────────────────────────────────────
    y = this.drawSectionTitle(doc, x0, y, W, 'DATOS DEL PERMISO');
    const t = v.transportista;
    const permisoDualRows: Array<
      [{ label: string; value: string }, { label: string; value: string } | null]
    > = [
      [
        { label: 'TRANSPORTE:', value: t?.nombre ?? '' },
        { label: 'PERMISO INTERNACIONAL:', value: t?.permisoInternacional ?? '' },
      ],
      [
        { label: 'PAUT:', value: t?.paut ?? '' },
        { label: 'FECHA VENCIMIENTO:', value: this.fmtDate(t?.fechaVencimientoPermiso) },
      ],
      [
        { label: 'CUIT:', value: t?.idFiscal ?? '' },
        { label: 'BANDERA:', value: t?.pais ?? '' },
      ],
      [{ label: 'DOMICILIO:', value: t?.domicilio ?? '' }, null],
    ];
    permisoDualRows.forEach(([left, right], i) => {
      const rowH = this.dualInfoRowHeight(doc, W, left, right);
      this.dualInfoRow(doc, x0, y, W, rowH, left, right, i % 2 === 1);
      y += rowH;
    });

    y += 12;

    // ── DATOS DEL VEHÍCULO (tabla) ────────────────────────────────────────────
    y = this.drawSectionTitle(doc, x0, y, W, 'DATOS DEL VEHÍCULO');
    const C0 = 155;
    const C1 = Math.floor((W - C0) / 2);
    const C2 = W - C0 - C1;
    const hdrFs = PAUT.body;
    const hdrY = this.rowTextY(y, HDR_H, hdrFs);
    const hdrPad = PAUT.pad;

    doc.rect(x0, y, W, HDR_H).fill(PAUT.navy);
    doc.fillColor(PAUT.white).font('Helvetica-Bold').fontSize(hdrFs);
    doc.text('CONCEPTO', x0 + hdrPad, hdrY, { width: C0 - hdrPad * 2, align: 'center', lineBreak: false });
    doc.text('CAMIÓN', x0 + C0 + hdrPad, hdrY, { width: C1 - hdrPad * 2, align: 'center', lineBreak: false });
    doc.text('SEMIRREMOLQUE', x0 + C0 + C1 + hdrPad, hdrY, {
      width: C2 - hdrPad * 2,
      align: 'center',
      lineBreak: false,
    });
    y += HDR_H;

    const vRows: Array<{ label: string; v1: string; v2: string }> = [
      { label: 'DOMINIO', v1: camion?.patente ?? '', v2: semi?.patente ?? '' },
      { label: 'MARCA', v1: camion?.marca ?? '', v2: semi?.marca ?? '' },
      { label: 'MODELO', v1: camion?.modelo ?? '', v2: semi?.modelo ?? '' },
      { label: 'AÑO', v1: camion?.anio ? String(camion.anio) : '', v2: semi?.anio ? String(semi.anio) : '' },
      { label: 'CHASIS NRO', v1: camion?.nroChasis ?? '', v2: semi?.nroChasis ?? '' },
      { label: 'POLIZA SEGURO', v1: camion?.poliza ?? '', v2: semi?.poliza ?? '' },
      {
        label: 'VENCIMIENTO POLIZA',
        v1: this.fmtDate(camion?.vencimientoPoliza),
        v2: this.fmtDate(semi?.vencimientoPoliza),
      },
      {
        label: 'TARA',
        v1: camion?.tara != null ? String(camion.tara) : '',
        v2: semi?.tara != null ? String(semi.tara) : '',
      },
      { label: 'PRECINTOS', v1: camion?.precinto ?? '', v2: semi?.precinto ?? '' },
    ];

    vRows.forEach((r, i) => {
      this.vehicleRow(doc, x0, y, C0, C1, C2, ROW_H, r.label, r.v1, r.v2, i % 2 === 1);
      y += ROW_H;
    });

    y += 12;

    // ── DATOS DEL CHOFER ──────────────────────────────────────────────────────
    y = this.drawSectionTitle(doc, x0, y, W, 'DATOS DEL CHOFER');
    const choferRows: Array<[string, string]> = [
      ['CHOFER:', v.chofer?.nombre ?? ''],
      ['CUIT:', v.chofer?.cuit ?? ''],
      ['DNI:', v.chofer?.dni ?? ''],
    ];
    choferRows.forEach(([label, value], i) => {
      const rowH = Math.max(PAUT.rowMinH, this.measureFieldBlockHeight(doc, W, label, value));
      this.infoRow(doc, x0, y, W, rowH, label, value, i % 2 === 1);
      y += rowH;
    });
  }
}
