import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../../shared/prisma/prisma.service';

const M = 42;
const PAGE_W = 595.28;
const CW = PAGE_W - M * 2;

type EgresoPdfRow = {
  fecha: Date;
  numeroRemito: string | null;
  entregadoPor: string | null;
  destinatario: string | null;
  destinoFinal: string | null;
  observaciones: string | null;
  cliente: { nombre: string };
  deposito: { nombre: string };
  movimientos: Array<{
    bultos: number;
    unidades: number;
    lote: string | null;
    observaciones: string | null;
    producto: { nombre: string; codigo: string | null };
    presentacion: {
      presentacion: { nombre: string };
    } | null;
  }>;
};

function fmtFechaAr(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function dash(v: string | null | undefined): string {
  const t = v?.trim();
  return t ? t : '—';
}

@Injectable()
export class RemitoInternoPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(tenantId: string, egresoId: string): Promise<Buffer> {
    const [op, tenant] = await Promise.all([
      this.prisma.stockOperacion.findFirst({
        where: { id: egresoId, tenantId, tipo: 'egreso' },
        include: {
          cliente: { select: { nombre: true } },
          deposito: { select: { nombre: true } },
          movimientos: {
            select: {
              bultos: true,
              unidades: true,
              lote: true,
              observaciones: true,
              producto: { select: { nombre: true, codigo: true } },
              presentacion: { select: { presentacion: { select: { nombre: true } } } },
            },
            orderBy: { id: 'asc' },
          },
        },
      }),
      this.prisma.tenant.findUnique({
        where: { clerkOrgId: tenantId },
        select: { name: true, idFiscal: true },
      }),
    ]);

    if (!op) throw new NotFoundException('Egreso no encontrado.');

    return this.buildPdf(op, tenant?.name ?? 'Empresa', tenant?.idFiscal ?? null);
  }

  private buildPdf(op: EgresoPdfRow, empresaNombre: string, empresaCuit: string | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: M, autoFirstPage: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let y = M;

        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .fillColor('#1a1a1a')
          .text(empresaNombre, M, y, { width: CW * 0.6 });
        if (empresaCuit?.trim()) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#555')
            .text(`CUIT: ${empresaCuit.trim()}`, M, y + 18, { width: CW * 0.6 });
        }

        const boxW = 150;
        const boxX = M + CW - boxW;
        doc.rect(boxX, y - 2, boxW, 52).stroke('#333');
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666')
          .text('REMITO INTERNO', boxX, y + 4, { width: boxW, align: 'center' });
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#1a1a1a')
          .text(dash(op.numeroRemito), boxX, y + 16, { width: boxW, align: 'center' });
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#444')
          .text(fmtFechaAr(op.fecha), boxX, y + 34, { width: boxW, align: 'center' });

        y += 62;
        doc.moveTo(M, y).lineTo(M + CW, y).stroke('#333');
        y += 14;

        const colW = CW / 2 - 8;
        const fields: Array<[string, string]> = [
          ['Cliente / Empresa', op.cliente.nombre],
          ['Depósito origen', op.deposito.nombre],
          ['Destinatario', dash(op.destinatario)],
          ['Dirección / Ruta', dash(op.destinoFinal)],
          ['Conductor', dash(op.entregadoPor)],
        ];

        for (let i = 0; i < fields.length; i += 2) {
          const left = fields[i];
          const right = fields[i + 1];
          doc.font('Helvetica').fontSize(7).fillColor('#666').text(left[0], M, y, { width: colW });
          doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a').text(left[1], M, y + 10, { width: colW });
          if (right) {
            doc.font('Helvetica').fontSize(7).fillColor('#666').text(right[0], M + colW + 16, y, { width: colW });
            doc
              .font('Helvetica')
              .fontSize(10)
              .fillColor('#1a1a1a')
              .text(right[1], M + colW + 16, y + 10, { width: colW });
          }
          y += 34;
        }

        y += 6;
        const cols = [
          { label: 'Código', w: CW * 0.1 },
          { label: 'Producto', w: CW * 0.22 },
          { label: 'Presentación', w: CW * 0.16 },
          { label: 'Bultos', w: CW * 0.1 },
          { label: 'Sueltas', w: CW * 0.1 },
          { label: 'Lote', w: CW * 0.12 },
          { label: 'Obs.', w: CW * 0.2 },
        ];

        const rowH = 22;
        let x = M;
        doc.rect(M, y, CW, rowH).fill('#f0f0f0');
        doc.fillColor('#444').font('Helvetica-Bold').fontSize(7);
        for (const col of cols) {
          doc.text(col.label, x + 4, y + 7, { width: col.w - 8 });
          x += col.w;
        }
        y += rowH;

        let totalBultos = 0;
        let totalSueltas = 0;
        doc.font('Helvetica').fontSize(8).fillColor('#1a1a1a');
        for (const mov of op.movimientos) {
          if (y > 700) {
            doc.addPage();
            y = M;
          }
          totalBultos += mov.bultos;
          totalSueltas += mov.unidades;
          x = M;
          const cells = [
            dash(mov.producto.codigo),
            mov.producto.nombre,
            mov.presentacion?.presentacion?.nombre ?? '—',
            String(mov.bultos),
            String(mov.unidades),
            dash(mov.lote),
            dash(mov.observaciones),
          ];
          doc.rect(M, y, CW, rowH).stroke('#ccc');
          for (let i = 0; i < cols.length; i++) {
            doc.text(cells[i], x + 4, y + 6, { width: cols[i].w - 8, lineBreak: false });
            x += cols[i].w;
          }
          y += rowH;
        }

        doc.rect(M, y, CW, rowH).fill('#f8f8f8');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a1a');
        x = M;
        const totalCells = ['', 'TOTAL', '', String(totalBultos), String(totalSueltas), '', ''];
        for (let i = 0; i < cols.length; i++) {
          doc.text(totalCells[i], x + 4, y + 6, { width: cols[i].w - 8, lineBreak: false });
          x += cols[i].w;
        }
        y += rowH;

        if (op.observaciones?.trim()) {
          y += 12;
          doc.font('Helvetica').fontSize(7).fillColor('#666').text('Observaciones', M, y);
          doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a').text(op.observaciones.trim(), M, y + 10, {
            width: CW,
          });
          y += doc.heightOfString(op.observaciones.trim(), { width: CW }) + 16;
        }

        const firmaY = Math.max(y + 24, 700);
        const half = CW / 2 - 12;
        doc
          .moveTo(M, firmaY)
          .lineTo(M + half, firmaY)
          .stroke('#333');
        doc
          .moveTo(M + half + 24, firmaY)
          .lineTo(M + CW, firmaY)
          .stroke('#333');
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666')
          .text('Entregado por — Firma y aclaración', M, firmaY + 6, { width: half, align: 'center' });
        doc.text('Recibí conforme — Firma, aclaración y DNI', M + half + 24, firmaY + 6, {
          width: half,
          align: 'center',
        });

        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#999')
          .text(
            'Documento interno sin validez fiscal. No reemplaza comprobantes oficiales.',
            M,
            800,
            { width: CW, align: 'center' },
          );

        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}
