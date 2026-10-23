import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';
import { ymdAr } from '../../shared/util/fecha-ar.util';

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

/** Tamaño máximo del logo del encabezado (se ajusta manteniendo la proporción). */
const LOGO_W = 110;
const LOGO_H = 55;

/**
 * Logo de Vialto (fallback cuando la empresa no cargó uno). Vive en `vialto-backend/assets`
 * (fuera de `src`, no lo copia el build): se lee desde el directorio de trabajo, que en
 * Render y en local es la carpeta del backend. Se cachea; sin archivo, null.
 */
let logoVialtoCache: Buffer | null | undefined;
function logoVialto(): Buffer | null {
  if (logoVialtoCache === undefined) {
    try {
      logoVialtoCache = readFileSync(join(process.cwd(), 'assets', 'vialto-logo.png'));
    } catch {
      logoVialtoCache = null;
    }
  }
  return logoVialtoCache;
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
type Col = { x: number; w: number };
type LayoutEstadoCuenta = {
  fecha: Col;
  tipo: Col;
  comprobante: Col;
  debe: Col;
  haber: Col;
  /** Una columna "Saldo acumulado" (moneda null) o una "Saldo {moneda}" por moneda. */
  saldos: (Col & { moneda: string | null })[];
};

/**
 * Columnas del estado de cuenta: Fecha · Tipo (el `concepto`: VENTA, COBRO, FACTURA A…) ·
 * Comprobante · Debe · Haber · Saldo. El comprobante es el dato principal de cada fila. Con
 * más de una moneda, el saldo se parte en una columna por moneda.
 */
function layoutEstadoCuenta(monedas: string[]): LayoutEstadoCuenta {
  const multi = monedas.length > 1;
  const anchos = multi
    ? { fecha: 52, tipo: 50, comprobante: 108, debe: 80, haber: 80 }
    : { fecha: 58, tipo: 62, comprobante: 130, debe: 78, haber: 78 };
  let x = MARGIN;
  const col = (w: number): Col => {
    const c = { x, w };
    x += w;
    return c;
  };
  const fecha = col(anchos.fecha);
  const tipo = col(anchos.tipo);
  const comprobante = col(anchos.comprobante);
  const debe = col(anchos.debe);
  const haber = col(anchos.haber);
  const resto = MARGIN + CONTENT_WIDTH - x;
  const saldos = multi
    ? monedas.map((moneda) => ({ ...col(resto / monedas.length), moneda }))
    : [{ ...col(resto), moneda: null }];
  return { fecha, tipo, comprobante, debe, haber, saldos };
}
const ROW_H = 18;
const PAGE_BOTTOM = 780;

// Listado de deudores: Contraparte · Tipo · Comprobante · Vencimiento · Pendiente.
const COLS_DEUDORES = {
  contraparte: { x: MARGIN, w: 140 },
  tipo: { x: MARGIN + 140, w: 62 },
  comprobante: { x: MARGIN + 140 + 62, w: 115 },
  vencimiento: { x: MARGIN + 140 + 62 + 115, w: 65 },
  pendiente: {
    x: MARGIN + 140 + 62 + 115 + 65,
    w: CONTENT_WIDTH - (140 + 62 + 115 + 65),
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
      logo: await this.logoEmpresa(tenantId),
      contraparteNombre: contraparte.nombre,
      contraparteTipo: esCliente ? 'Cliente' : 'Proveedor',
      reporte,
    });
    const filename = `estado-cuenta-${slugify(contraparte.nombre)}-${query.desde}-${query.hasta}.pdf`;
    return { buffer, filename };
  }

  /**
   * Logo para el encabezado: el de la empresa (cargado en Configuración ARCA, mismo que usan
   * las facturas) o, si no tiene o no se puede descargar, el de Vialto. Nunca tira: sin
   * ninguno de los dos, el PDF sale sin logo.
   */
  private async logoEmpresa(tenantId: string): Promise<Buffer | null> {
    const config = await this.prisma.arcaConfig.findUnique({
      where: { tenantId },
      select: { logoUrl: true },
    });
    if (config?.logoUrl) {
      try {
        const res = await fetch(config.logoUrl);
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch {
        // cae al logo de Vialto
      }
    }
    return logoVialto();
  }

  /**
   * Logo arriba a la derecha, a la altura del nombre de la empresa (estado de cuenta y
   * listado de deudores). Si la imagen no se puede leer (formato no soportado por pdfkit),
   * el PDF sale igual sin logo.
   */
  private drawLogo(doc: PDFKit.PDFDocument, logo: Buffer | null) {
    if (!logo) return;
    try {
      doc.image(logo, MARGIN + CONTENT_WIDTH - LOGO_W, MARGIN, {
        fit: [LOGO_W, LOGO_H],
        align: 'right',
      });
    } catch {
      // sin logo
    }
    doc.x = MARGIN;
    doc.y = MARGIN;
  }

  /**
   * "Pendientes de cobro" (clientes) o "Pendientes de pago" (proveedores): mismos datos y
   * agrupamiento que el tablero del dashboard (vencidos / próximos / sin vencimiento), de UN
   * solo lado, con su total. Antes era un único "Listado de deudores" con los dos lados.
   */
  async generateListadoDeudores(tenantId: string, lado: 'cliente' | 'proveedor', diasProximos?: number) {
    const [tenant, tablero] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { clerkOrgId: tenantId }, select: { name: true } }),
      this.cuentaCorriente.tablero(tenantId, diasProximos),
    ]);

    const buffer = await this.buildListadoDeudoresPdf({
      tenantName: tenant?.name ?? 'Vialto',
      logo: await this.logoEmpresa(tenantId),
      tablero,
      lado,
    });
    const filename = `${lado === 'cliente' ? 'pendientes-de-cobro' : 'pendientes-de-pago'}-${ymdAr()}.pdf`;
    return { buffer, filename };
  }

  private buildListadoDeudoresPdf(params: {
    tenantName: string;
    /** Logo de la empresa o de Vialto (arriba a la derecha); null = sin logo. */
    logo: Buffer | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tablero: any;
    lado: 'cliente' | 'proveedor';
  }): Promise<Buffer> {
    const { tenantName, logo, tablero, lado } = params;
    const esCobro = lado === 'cliente';
    const clave = esCobro ? 'cobrar' : 'pagar';
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawLogo(doc, logo);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000')
          .text(tenantName, MARGIN, MARGIN, { width: CONTENT_WIDTH - (logo ? LOGO_W + 10 : 0) });
        doc.fontSize(11).font('Helvetica').fillColor('#333')
          .text(esCobro ? 'Pendientes de cobro' : 'Pendientes de pago');
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
          const items = grupo[clave];
          if (items.length === 0) continue;
          huboContenido = true;

          if (y + 20 > PAGE_BOTTOM) {
            doc.addPage();
            y = MARGIN;
          }
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(titulo, MARGIN, y);
          y = doc.y + 6;
          y = this.drawListadoSubseccion(doc, y, items, esCobro ? 'Cliente' : 'Proveedor');
          y += 8;
        }

        if (!huboContenido) {
          doc.font('Helvetica').fontSize(10).fillColor('#333')
            .text(`No hay comprobantes pendientes de ${esCobro ? 'cobro' : 'pago'}.`, MARGIN, y);
          y = doc.y;
        }

        if (y + 40 > PAGE_BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        y += 6;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
        y += 10;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000')
          .text(esCobro ? 'Total a cobrar pendiente' : 'Total a pagar pendiente', MARGIN, y);
        y += 14;
        const totales = (esCobro ? tablero.totales.porCobrarPendiente : tablero.totales.porPagarPendiente) as {
          moneda: string;
          total: number;
        }[];
        for (const t of totales) {
          doc.font('Helvetica').fontSize(9).fillColor('#333')
            .text(`${t.moneda} ${fmtMoney(t.total)}`, MARGIN, y);
          y += 13;
        }

        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#999')
          .text(`Generado el ${fmtDate(new Date())} | Vialto Software`, MARGIN, doc.page.height - MARGIN - 15, {
            width: CONTENT_WIDTH,
            align: 'center',
          });

        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Tabla de un grupo (vencidos / próximos / sin vencimiento) del listado, con salto de página si hace falta. */
  private drawListadoSubseccion(
    doc: PDFKit.PDFDocument,
    yStart: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: any[],
    /** Encabezado de la primera columna: "Cliente" o "Proveedor". */
    contraparteLabel: string,
  ): number {
    let y = yStart;
    if (y + 20 > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    y = this.drawListadoHeader(doc, y, contraparteLabel);

    doc.font('Helvetica').fontSize(8.5).fillColor('#000');
    for (const it of items) {
      if (y + ROW_H > PAGE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
        y = this.drawListadoHeader(doc, y, contraparteLabel);
        doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      }
      doc.text(it.contraparteNombre ?? '—', COLS_DEUDORES.contraparte.x, y, {
        width: COLS_DEUDORES.contraparte.w - 5,
        height: ROW_H - 4,
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(it.concepto, COLS_DEUDORES.tipo.x, y, {
        width: COLS_DEUDORES.tipo.w - 5,
        height: ROW_H - 4,
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(it.numeroComprobante?.trim() || '—', COLS_DEUDORES.comprobante.x, y, {
        width: COLS_DEUDORES.comprobante.w - 5,
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

  private drawListadoHeader(doc: PDFKit.PDFDocument, y: number, contraparteLabel: string): number {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text(contraparteLabel, COLS_DEUDORES.contraparte.x, y, { width: COLS_DEUDORES.contraparte.w });
    doc.text('Tipo', COLS_DEUDORES.tipo.x, y, { width: COLS_DEUDORES.tipo.w });
    doc.text('Comprobante', COLS_DEUDORES.comprobante.x, y, { width: COLS_DEUDORES.comprobante.w });
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
    /** Logo de la empresa o de Vialto (arriba a la derecha); null = sin logo. */
    logo: Buffer | null;
    contraparteNombre: string;
    contraparteTipo: 'Cliente' | 'Proveedor';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reporte: any;
  }): Promise<Buffer> {
    const { tenantName, logo, contraparteNombre, contraparteTipo, reporte } = params;
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawLogo(doc, logo);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000')
          .text(tenantName, MARGIN, MARGIN, { width: CONTENT_WIDTH - (logo ? LOGO_W + 10 : 0) });
        doc.fontSize(11).font('Helvetica').fillColor('#333').text('Estado de cuenta');
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
          .text(`${contraparteTipo}: ${contraparteNombre}`);
        doc.font('Helvetica').fontSize(9).fillColor('#333')
          .text(`Período: ${fmtDate(new Date(reporte.periodo.desde))} — ${fmtDate(new Date(reporte.periodo.hasta))}`);
        doc.moveDown(1);

        const saldosIniciales = reporte.saldoInicial as { moneda: string; saldo: number }[];
        const saldosFinales = reporte.saldoFinal as { moneda: string; saldo: number }[];
        // Una moneda: columna única "Saldo acumulado". Varias: una columna de saldo por
        // moneda ("Saldo ARS", "Saldo USD"), cada fila con el saldo de todas a ese momento.
        const monedas = saldosFinales.map((s) => s.moneda);
        const layout = layoutEstadoCuenta(monedas);
        const multimoneda = layout.saldos.length > 1;

        // Saldo de cada moneda después de cada movimiento: se recorre del más viejo al más
        // nuevo (la lista viene al revés) arrastrando el último saldo conocido de cada moneda.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const movs = reporte.movimientos as any[];
        const saldosPorFila = new Map<string, Map<string, number>>();
        const corriendo = new Map(saldosIniciales.map((s) => [s.moneda, s.saldo]));
        for (const mov of [...movs].reverse()) {
          corriendo.set(mov.moneda, mov.saldoAcumulado);
          saldosPorFila.set(mov.id, new Map(corriendo));
        }

        let y = doc.y;
        y = this.drawTableHeader(doc, y, layout);

        doc.font('Helvetica').fontSize(8.5).fillColor('#000');
        for (const mov of movs) {
          if (y + ROW_H > PAGE_BOTTOM) {
            doc.addPage();
            y = MARGIN;
            y = this.drawTableHeader(doc, y, layout);
            doc.font('Helvetica').fontSize(8.5).fillColor('#000');
          }
          const esDebe = mov.tipo === 'cargo';
          // Con varias monedas, el importe lleva la suya (si no, no se sabe de cuál es).
          const importe = `${fmtMoney(mov.importe)}${multimoneda ? ` ${mov.moneda}` : ''}`;
          doc.text(fmtDate(new Date(mov.fecha)), layout.fecha.x, y, { width: layout.fecha.w });
          doc.text(mov.concepto, layout.tipo.x, y, {
            width: layout.tipo.w - 5,
            height: ROW_H - 4,
            ellipsis: true,
            lineBreak: false,
          });
          doc.text(mov.numeroComprobante?.trim() || '—', layout.comprobante.x, y, {
            width: layout.comprobante.w - 5,
            height: ROW_H - 4,
            ellipsis: true,
            lineBreak: false,
          });
          doc.text(esDebe ? importe : '—', layout.debe.x, y, { width: layout.debe.w - 5, align: 'right' });
          doc.text(!esDebe ? importe : '—', layout.haber.x, y, { width: layout.haber.w - 5, align: 'right' });
          if (multimoneda) {
            const saldos = saldosPorFila.get(mov.id);
            for (const col of layout.saldos) {
              doc.text(fmtMoney(saldos?.get(col.moneda!) ?? 0), col.x, y, { width: col.w - 5, align: 'right' });
            }
          } else {
            const col = layout.saldos[0];
            doc.text(`${fmtMoney(mov.saldoAcumulado)} ${mov.moneda}`, col.x, y, { width: col.w - 5, align: 'right' });
          }
          y += ROW_H;
        }

        // Saldo inicial y final, nunca sumados entre monedas: con varias monedas, cada uno
        // va debajo de su columna; con una, una línea cada uno.
        y += 10;
        if (y + 52 > PAGE_BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        doc.moveTo(layout.debe.x, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
        y += 8;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000');
        for (const [label, saldos] of [
          ['Saldo inicial', saldosIniciales],
          ['Saldo final', saldosFinales],
        ] as const) {
          doc.text(label, layout.debe.x, y, { width: layout.debe.w + layout.haber.w - 5, align: 'right' });
          if (multimoneda) {
            for (const col of layout.saldos) {
              const s = saldos.find((x) => x.moneda === col.moneda);
              doc.text(fmtMoney(s?.saldo ?? 0), col.x, y, { width: col.w - 5, align: 'right' });
            }
          } else {
            const s = saldos[0];
            const col = layout.saldos[0];
            doc.text(`${fmtMoney(s?.saldo ?? 0)}${s?.moneda ? ` ${s.moneda}` : ''}`, col.x, y, {
              width: col.w - 5,
              align: 'right',
            });
          }
          y += 16;
        }

        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#999')
          .text(`Generado el ${fmtDate(new Date())}  | Vialto Software`, MARGIN, doc.page.height - MARGIN - 15, {
            width: CONTENT_WIDTH,
            align: 'center',
          });

        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawTableHeader(doc: PDFKit.PDFDocument, y: number, layout: LayoutEstadoCuenta): number {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text('Fecha', layout.fecha.x, y, { width: layout.fecha.w });
    doc.text('Tipo', layout.tipo.x, y, { width: layout.tipo.w });
    doc.text('Comprobante', layout.comprobante.x, y, { width: layout.comprobante.w });
    doc.text('Debe', layout.debe.x, y, { width: layout.debe.w - 5, align: 'right' });
    doc.text('Haber', layout.haber.x, y, { width: layout.haber.w - 5, align: 'right' });
    for (const col of layout.saldos) {
      doc.text(col.moneda ? `Saldo ${col.moneda}` : 'Saldo acumulado', col.x, y, {
        width: col.w - 5,
        align: 'right',
      });
    }
    y += 12;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
    return y + 6;
  }
}
