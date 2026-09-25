import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'cuenta';
}

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4 en puntos
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLS = {
  fecha: { x: MARGIN, w: 65 },
  concepto: { x: MARGIN + 65, w: 210 },
  debe: { x: MARGIN + 65 + 210, w: 80 },
  haber: { x: MARGIN + 65 + 210 + 80, w: 80 },
  saldo: { x: MARGIN + 65 + 210 + 80 + 80, w: CONTENT_WIDTH - (65 + 210 + 80 + 80) },
};
const ROW_H = 18;
const PAGE_BOTTOM = 780;

@Injectable()
export class EstadoCuentaPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentaCorriente: CuentaCorrienteService,
  ) {}

  async generate(tenantId: string, query: ExportarMovimientosQueryDto) {
    const esCliente = !!query.clienteId;
    const [tenant, contraparte, reporte] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { clerkOrgId: tenantId },
        select: { name: true },
      }),
      esCliente
        ? this.prisma.cliente.findFirst({ where: { id: query.clienteId, tenantId } })
        : this.prisma.transportista.findFirst({ where: { id: query.proveedorId, tenantId } }),
      this.cuentaCorriente.exportarMovimientos(tenantId, query),
    ]);
    if (!contraparte) throw new NotFoundException('Contraparte no encontrada');

    const buffer = await this.buildPdf({
      tenantName: tenant?.name ?? 'Vialto',
      contraparteNombre: contraparte.nombre,
      contraparteTipo: esCliente ? 'Cliente' : 'Proveedor',
      reporte,
    });
    const filename = `estado-cuenta-${slugify(contraparte.nombre)}-${query.desde}-${query.hasta}.pdf`;
    return { buffer, filename };
  }

  private buildPdf(params: {
    tenantName: string;
    contraparteNombre: string;
    contraparteTipo: 'Cliente' | 'Proveedor';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reporte: any;
  }): Promise<Buffer> {
    const { tenantName, contraparteNombre, contraparteTipo, reporte } = params;
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text(tenantName);
        doc.fontSize(11).font('Helvetica').fillColor('#333').text('Estado de cuenta');
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
          .text(`${contraparteTipo}: ${contraparteNombre}`);
        doc.font('Helvetica').fontSize(9).fillColor('#333')
          .text(`Período: ${fmtDate(new Date(reporte.periodo.desde))} — ${fmtDate(new Date(reporte.periodo.hasta))}`);
        doc.moveDown(1);

        let y = doc.y;
        y = this.drawTableHeader(doc, y);

        doc.font('Helvetica').fontSize(8.5).fillColor('#000');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const mov of reporte.movimientos as any[]) {
          if (y + ROW_H > PAGE_BOTTOM) {
            doc.addPage();
            y = MARGIN;
            y = this.drawTableHeader(doc, y);
            doc.font('Helvetica').fontSize(8.5).fillColor('#000');
          }
          const esDebe = mov.tipo === 'cargo';
          doc.text(fmtDate(new Date(mov.fecha)), COLS.fecha.x, y, { width: COLS.fecha.w });
          doc.text(mov.concepto, COLS.concepto.x, y, {
            width: COLS.concepto.w - 5,
            height: ROW_H - 4,
            ellipsis: true,
            lineBreak: false,
          });
          doc.text(esDebe ? fmtMoney(mov.importe) : '—', COLS.debe.x, y, {
            width: COLS.debe.w - 5,
            align: 'right',
          });
          doc.text(!esDebe ? fmtMoney(mov.importe) : '—', COLS.haber.x, y, {
            width: COLS.haber.w - 5,
            align: 'right',
          });
          doc.text(`${fmtMoney(mov.saldoAcumulado)} ${mov.moneda}`, COLS.saldo.x, y, {
            width: COLS.saldo.w - 5,
            align: 'right',
          });
          y += ROW_H;
        }

        y += 10;
        if (y + 50 > PAGE_BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        doc.moveTo(COLS.debe.x, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
        y += 8;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000');
        doc.text('Saldo inicial', COLS.debe.x, y, { width: COLS.haber.w, align: 'right' });
        doc.text(fmtMoney(reporte.saldoInicial), COLS.saldo.x, y, { width: COLS.saldo.w - 5, align: 'right' });
        y += 16;
        doc.text('Saldo final', COLS.debe.x, y, { width: COLS.haber.w, align: 'right' });
        doc.text(fmtMoney(reporte.saldoFinal), COLS.saldo.x, y, { width: COLS.saldo.w - 5, align: 'right' });

        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#999')
          .text(`Generado el ${fmtDate(new Date())} — Vialto`, MARGIN, doc.page.height - MARGIN - 15, {
            width: CONTENT_WIDTH,
            align: 'center',
          });

        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text('Fecha', COLS.fecha.x, y, { width: COLS.fecha.w });
    doc.text('Concepto', COLS.concepto.x, y, { width: COLS.concepto.w });
    doc.text('Debe', COLS.debe.x, y, { width: COLS.debe.w - 5, align: 'right' });
    doc.text('Haber', COLS.haber.x, y, { width: COLS.haber.w - 5, align: 'right' });
    doc.text('Saldo acumulado', COLS.saldo.x, y, { width: COLS.saldo.w - 5, align: 'right' });
    y += 12;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
    return y + 6;
  }
}
