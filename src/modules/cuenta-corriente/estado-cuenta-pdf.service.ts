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

const COLS_DEUDORES = {
  contraparte: { x: MARGIN, w: 150 },
  concepto: { x: MARGIN + 150, w: 165 },
  vencimiento: { x: MARGIN + 150 + 165, w: 70 },
  pendiente: {
    x: MARGIN + 150 + 165 + 70,
    w: CONTENT_WIDTH - (150 + 165 + 70),
  },
};

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

  /** Listado de deudores: mismos datos y agrupamiento que el tablero del dashboard (vencidos / próximos / sin vencimiento, a cobrar / a pagar), exportado a PDF. */
  async generateListadoDeudores(tenantId: string, diasProximos?: number) {
    const [tenant, tablero] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { clerkOrgId: tenantId }, select: { name: true } }),
      this.cuentaCorriente.tablero(tenantId, diasProximos),
    ]);

    const buffer = await this.buildListadoDeudoresPdf({
      tenantName: tenant?.name ?? 'Vialto',
      tablero,
    });
    const filename = `listado-deudores-${new Date().toISOString().slice(0, 10)}.pdf`;
    return { buffer, filename };
  }

  private buildListadoDeudoresPdf(params: {
    tenantName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tablero: any;
  }): Promise<Buffer> {
    const { tenantName, tablero } = params;
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text(tenantName);
        doc.fontSize(11).font('Helvetica').fillColor('#333').text('Listado de deudores');
        doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Al ${fmtDate(new Date())}`);
        doc.moveDown(1);

        let y = doc.y;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grupos: Array<{ titulo: string; grupo: any }> = [
          { titulo: 'Vencidos', grupo: tablero.vencidos },
          { titulo: 'Próximos a vencer', grupo: tablero.proximosVencimientos },
          { titulo: 'Sin vencimiento configurado', grupo: tablero.sinVencimiento },
        ];

        let huboContenido = false;
        for (const { titulo, grupo } of grupos) {
          if (grupo.cobrar.length === 0 && grupo.pagar.length === 0) continue;
          huboContenido = true;

          if (y + 20 > PAGE_BOTTOM) {
            doc.addPage();
            y = MARGIN;
          }
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(titulo, MARGIN, y);
          y = doc.y + 6;

          if (grupo.cobrar.length > 0) {
            y = this.drawListadoSubseccion(doc, y, 'A cobrar', grupo.cobrar);
          }
          if (grupo.pagar.length > 0) {
            y = this.drawListadoSubseccion(doc, y, 'A pagar', grupo.pagar);
          }
          y += 8;
        }

        if (!huboContenido) {
          doc.font('Helvetica').fontSize(10).fillColor('#333')
            .text('No hay comprobantes pendientes de cobro ni de pago.', MARGIN, y);
          y = doc.y;
        }

        if (y + 60 > PAGE_BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        y += 6;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
        y += 10;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text('Total a cobrar pendiente', MARGIN, y);
        y += 14;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const t of tablero.totales.porCobrarPendiente as any[]) {
          doc.font('Helvetica').fontSize(9).fillColor('#333')
            .text(`${t.moneda} ${fmtMoney(t.total)}`, MARGIN, y);
          y += 13;
        }
        y += 6;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text('Total a pagar pendiente', MARGIN, y);
        y += 14;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const t of tablero.totales.porPagarPendiente as any[]) {
          doc.font('Helvetica').fontSize(9).fillColor('#333')
            .text(`${t.moneda} ${fmtMoney(t.total)}`, MARGIN, y);
          y += 13;
        }

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

  /** Tabla de una subsección (A cobrar / A pagar) del listado de deudores, con salto de página si hace falta. */
  private drawListadoSubseccion(
    doc: PDFKit.PDFDocument,
    yStart: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    titulo: string,
    items: any[],
  ): number {
    let y = yStart;
    if (y + 20 > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#e8470a').text(titulo, MARGIN + 8, y);
    y = doc.y + 4;
    y = this.drawListadoHeader(doc, y);

    doc.font('Helvetica').fontSize(8.5).fillColor('#000');
    for (const it of items) {
      if (y + ROW_H > PAGE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
        y = this.drawListadoHeader(doc, y);
        doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      }
      doc.text(it.contraparteNombre ?? '—', COLS_DEUDORES.contraparte.x, y, {
        width: COLS_DEUDORES.contraparte.w - 5,
        height: ROW_H - 4,
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(it.concepto, COLS_DEUDORES.concepto.x, y, {
        width: COLS_DEUDORES.concepto.w - 5,
        height: ROW_H - 4,
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(
        it.fechaVencimiento ? fmtDate(new Date(it.fechaVencimiento)) : '—',
        COLS_DEUDORES.vencimiento.x,
        y,
        { width: COLS_DEUDORES.vencimiento.w - 5 },
      );
      doc.text(`${fmtMoney(it.pendiente)} ${it.moneda}`, COLS_DEUDORES.pendiente.x, y, {
        width: COLS_DEUDORES.pendiente.w - 5,
        align: 'right',
      });
      y += ROW_H;
    }
    return y + 4;
  }

  private drawListadoHeader(doc: PDFKit.PDFDocument, y: number): number {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text('Contraparte', COLS_DEUDORES.contraparte.x, y, { width: COLS_DEUDORES.contraparte.w });
    doc.text('Concepto', COLS_DEUDORES.concepto.x, y, { width: COLS_DEUDORES.concepto.w });
    doc.text('Vencimiento', COLS_DEUDORES.vencimiento.x, y, { width: COLS_DEUDORES.vencimiento.w });
    doc.text('Pendiente', COLS_DEUDORES.pendiente.x, y, {
      width: COLS_DEUDORES.pendiente.w - 5,
      align: 'right',
    });
    y += 12;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
    return y + 6;
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
