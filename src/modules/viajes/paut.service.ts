import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: new (opts?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument = require('pdfkit');
import { PrismaService } from '../../shared/prisma/prisma.service';

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
  numero: string;
  transportista: {
    id: string;
    nombre: string;
    idFiscal: string | null;
    paut: string | null;
    permisoInternacional: string | null;
    fechaVencimientoPermiso: Date | null;
    domicilio: string | null;
    bandera: string | null;
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
            bandera: true,
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
      if (!viaje.transportista.bandera?.trim()) t.push('Bandera (país)');
      if (t.length > 0) missingGroups['Transportista'] = { fields: t, entityId: viaje.transportista.id };
    }

    // Vehículos — se calcula aquí para validar campos Y reutilizar en el PDF
    const sorted = [...viaje.vehiculosViaje].sort((a, b) => a.orden - b.orden);
    const camion = sorted[0]?.vehiculo ?? null;
    const semi =
      sorted.length > 1
        ? (sorted.slice(1).find((vv) => vv.vehiculo.tipo === 'semirremolque')?.vehiculo ??
           sorted[1]?.vehiculo ??
           null)
        : null;

    if (sorted.length === 0) {
      viajeFields.push('Al menos un vehículo asignado');
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

    if (viajeFields.length > 0) missingGroups['Viaje'] = { fields: viajeFields };

    if (Object.keys(missingGroups).length > 0) {
      throw new BadRequestException({
        message: 'Faltan datos para generar el PAUT',
        missingGroups,
      });
    }

    return this.buildPdf(viaje, camion, semi);
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

  private infoRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    labelW: number,
  ) {
    doc.rect(x, y, labelW, h).stroke();
    doc.rect(x + labelW, y, w - labelW, h).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(label, x + 4, y + (h - 8) / 2, { width: labelW - 8, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(value, x + labelW + 4, y + (h - 9) / 2, { width: w - labelW - 8, lineBreak: false });
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
    valueFontSize = 8,
  ) {
    doc.rect(x, y, c0, h).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(label, x + 4, y + (h - 8) / 2, { width: c0 - 8, lineBreak: false });
    doc.rect(x + c0, y, c1, h).stroke();
    doc
      .font('Helvetica')
      .fontSize(valueFontSize)
      .text(val1, x + c0 + 4, y + (h - valueFontSize) / 2, { width: c1 - 8, lineBreak: false });
    doc.rect(x + c0 + c1, y, c2, h).stroke();
    doc
      .font('Helvetica')
      .fontSize(valueFontSize)
      .text(val2, x + c0 + c1 + 4, y + (h - valueFontSize) / 2, { width: c2 - 8, lineBreak: false });
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
    const ROW_H = 22;
    const LW = 170;

    // ── Título ────────────────────────────────────────────────────────────────
    doc.rect(x0, y, W, 30).fill('#1a1a1a');
    doc
      .fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('PERMISO DE ACTUACIÓN DEL TRANSPORTE (PAUT)', x0, y + 9, {
        width: W,
        align: 'center',
      });
    doc.fillColor('black');
    y += 30 + 12;

    // ── Sección empresa ───────────────────────────────────────────────────────
    const t = v.transportista;
    const empresaRows: Array<[string, string]> = [
      ['TRANSPORTE:', t?.nombre ?? ''],
      ['PAUT:', t?.paut ?? ''],
      ['CUIT:', t?.idFiscal ?? ''],
      ['DOMICILIO:', t?.domicilio ?? ''],
      ['PERMISO INTERNACIONAL:', t?.permisoInternacional ?? ''],
      ['FECHA VENCIMIENTO:', this.fmtDate(t?.fechaVencimientoPermiso)],
      ['BANDERA:', t?.bandera ?? ''],
    ];

    for (const [label, value] of empresaRows) {
      this.infoRow(doc, x0, y, W, ROW_H, label, value, LW);
      y += ROW_H;
    }

    y += 12;

    // ── Tabla vehículos ───────────────────────────────────────────────────────
    const C0 = 160;
    const C1 = Math.floor((W - C0) / 2);
    const C2 = W - C0 - C1;
    const HDR_H = 22;

    doc.rect(x0, y, C0, HDR_H).fillAndStroke('#1a1a1a', '#000');
    doc.rect(x0 + C0, y, C1, HDR_H).fillAndStroke('#1a1a1a', '#000');
    doc.rect(x0 + C0 + C1, y, C2, HDR_H).fillAndStroke('#1a1a1a', '#000');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(8);
    doc.text('CONCEPTO', x0 + 4, y + (HDR_H - 8) / 2, { width: C0 - 8, align: 'center', lineBreak: false });
    doc.text('CAMION', x0 + C0 + 4, y + (HDR_H - 8) / 2, { width: C1 - 8, align: 'center', lineBreak: false });
    doc.text('SEMIRREMOLQUE', x0 + C0 + C1 + 4, y + (HDR_H - 8) / 2, { width: C2 - 8, align: 'center', lineBreak: false });
    doc.fillColor('black');
    y += HDR_H;

    type VRow = { label: string; v1: string; v2: string; fs?: number };
    const vRows: VRow[] = [
      { label: 'DOMINIO', v1: camion?.patente ?? '', v2: semi?.patente ?? '', fs: 11 },
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
        label: 'TARA:',
        v1: camion?.tara != null ? String(camion.tara) : '',
        v2: semi?.tara != null ? String(semi.tara) : '',
      },
      { label: 'PRECINTOS:', v1: camion?.precinto ?? '', v2: semi?.precinto ?? '' },
    ];

    for (const r of vRows) {
      this.vehicleRow(doc, x0, y, C0, C1, C2, ROW_H, r.label, r.v1, r.v2, r.fs ?? 8);
      y += ROW_H;
    }

    y += 12;

    // ── Datos del chofer ──────────────────────────────────────────────────────
    const choferRows: Array<[string, string]> = [
      ['CHOFER', v.chofer?.nombre ?? ''],
      ['CUIT', v.chofer?.cuit ?? ''],
      ['DNI', v.chofer?.dni ?? ''],
    ];

    for (const [label, value] of choferRows) {
      this.infoRow(doc, x0, y, W, ROW_H, label, value, LW);
      y += ROW_H;
    }
  }
}
