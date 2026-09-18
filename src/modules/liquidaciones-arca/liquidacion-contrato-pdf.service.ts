import { Injectable, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArcaConfigService } from './arca-config.service';
import { numeroVisibleViaje } from '../viajes/viaje-numero-visible.util';
import {
  adelantoDesdePagos,
  buildLiquidacionContratoTotales,
  crtMicRemitoDesdeDocumento,
  fmtContratoDate,
  mercaderiaDesdeProductos,
  type LiquidacionContratoTotales,
  type LiquidacionContratoViajeInput,
} from './liquidacion-contrato.util';
import { normalizeUnidadCantidad, unidadCantidadPlural, type UnidadCantidad } from './cantidad-unidad.util';

const M = 40;
const PAGE_W = 595.28;
const CW = PAGE_W - M * 2;
const CHARCOAL = '#2c2c2c';
const STEEL = '#6b7280';
const LINE = '#d4d4d4';

function fmtMoney(n: number, moneda: string): string {
  const formatted = n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${moneda} ${formatted}`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function dash(v: string | null | undefined): string {
  const s = v?.trim();
  return s ? s : '—';
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

@Injectable()
export class LiquidacionContratoPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arcaConfig: ArcaConfigService,
  ) {}

  async generate(
    tenantId: string,
    liquidacionId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const liq = await this.prisma.liquidacion.findFirst({
      where: { id: liquidacionId, tenantId },
      include: {
        transportista: {
          select: {
            nombre: true,
            idFiscal: true,
            domicilio: true,
            pais: true,
          },
        },
        tenant: { select: { name: true } },
        viajes: {
          include: {
            viaje: {
              select: {
                numero: true,
                numeroIdentificacionPersonalizado: true,
                idPropio2: true,
                origen: true,
                destino: true,
                fechaCarga: true,
                fechaDescarga: true,
                detalleCarga: true,
                documentoAduanero: true,
                pagosTransportista: true,
                cantidadTransportista: true,
                precioUnitarioTransportista: true,
                precioTransportistaExterno: true,
                monedaPrecioTransportistaExterno: true,
                chofer: { select: { nombre: true } },
                productosViaje: {
                  orderBy: { orden: 'asc' },
                  select: {
                    pesoKg: true,
                    producto: { select: { nombre: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!liq) throw new NotFoundException('Liquidación no encontrada');

    const tenantIdPropio2 = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: {
        idPropio2Habilitado: true,
        idPropio2Label: true,
        unidadCantidadViajes: true,
      },
    });
    const unidad = normalizeUnidadCantidad(tenantIdPropio2?.unidadCantidadViajes);

    const viajes: LiquidacionContratoViajeInput[] = liq.viajes.map((lv) => {
      const v = lv.viaje;
      const idPropio2ValorRaw = v.idPropio2?.trim();
      const idPropio2Habilitado = Boolean(
        tenantIdPropio2?.idPropio2Habilitado && idPropio2ValorRaw,
      );
      const idPropio2Label = idPropio2Habilitado
        ? tenantIdPropio2?.idPropio2Label?.trim() || 'ID Propio 2'
        : null;
      const idPropio2Valor = idPropio2Habilitado ? idPropio2ValorRaw : null;
      const moneda = (v.monedaPrecioTransportistaExterno || 'ARS').toUpperCase();
      const docs = crtMicRemitoDesdeDocumento(v.documentoAduanero);
      const toneladas = lv.tnDestino ?? v.cantidadTransportista ?? null;
      const precioPorTn =
        lv.tarifaTransportista ?? v.precioUnitarioTransportista ?? null;
      const subtotal =
        lv.subtotal ??
        v.precioTransportistaExterno ??
        (toneladas != null && precioPorTn != null
          ? toneladas * precioPorTn
          : 0);
      return {
        numero: numeroVisibleViaje(v),
        numeroIdentificacionPersonalizado: v.numeroIdentificacionPersonalizado,
        idPropio2Label,
        idPropio2Valor,
        origen: v.origen,
        destino: v.destino,
        fechaCarga: v.fechaCarga,
        fechaDescarga: v.fechaDescarga,
        choferNombre: v.chofer?.nombre ?? null,
        mercaderia: mercaderiaDesdeProductos(v.productosViaje, v.detalleCarga),
        crt: docs.crt,
        mic: docs.mic,
        remito: docs.remito,
        toneladas,
        precioPorTn,
        subtotal: Number(subtotal) || 0,
        adelanto: adelantoDesdePagos(v.pagosTransportista, moneda),
        moneda,
      };
    });

    const totales = buildLiquidacionContratoTotales({
      viajes,
      ivaPct: liq.ivaPct ?? 21,
    });

    let emisorNombre = liq.tenant?.name?.trim() || 'Liquidación';
    let logoUrl: string | null = null;
    try {
      const config = await this.arcaConfig.findPublic(tenantId);
      if (config?.razonSocial?.trim()) emisorNombre = config.razonSocial.trim();
      logoUrl = config?.logoUrl ?? null;
    } catch {
      /* tenant sin ARCA: usa el nombre de la empresa */
    }

    let logoBuffer: Buffer | null = null;
    if (logoUrl) {
      try {
        const fetched = await fetch(logoUrl);
        if (fetched.ok) logoBuffer = Buffer.from(await fetched.arrayBuffer());
      } catch {
        logoBuffer = null;
      }
    }

    const buffer = await this.buildPdf(liq, emisorNombre, logoBuffer, totales, unidad);
    const slug = (liq.transportista?.nombre ?? 'transportista')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    return {
      buffer,
      filename: `Liquidacion_${slug || liq.id.slice(0, 8)}.pdf`,
    };
  }

  private buildPdf(
    liq: {
      periodoDesde: Date;
      periodoHasta: Date;
      cantViajes: number;
      transportista: {
        nombre: string;
        idFiscal: string | null;
        domicilio: string | null;
        pais: string | null;
      } | null;
    },
    emisorNombre: string,
    logoBuffer: Buffer | null,
    totales: LiquidacionContratoTotales,
    unidad: UnidadCantidad,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: M,
          autoFirstPage: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        this.draw(doc, liq, emisorNombre, logoBuffer, totales, unidad);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private draw(
    doc: PDFKit.PDFDocument,
    liq: {
      periodoDesde: Date;
      periodoHasta: Date;
      cantViajes: number;
      transportista: {
        nombre: string;
        idFiscal: string | null;
        domicilio: string | null;
        pais: string | null;
      } | null;
    },
    emisorNombre: string,
    logoBuffer: Buffer | null,
    totales: LiquidacionContratoTotales,
    unidad: UnidadCantidad,
  ) {
    let y = M;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, M, y, { height: 36 });
      } catch {
        /* logo inválido */
      }
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(CHARCOAL)
      .text(emisorNombre.toUpperCase(), M, y, { width: CW, align: 'right' });
    y += 42;

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(CHARCOAL)
      .text('LIQUIDACIÓN DE FLETE', M, y, { width: CW, align: 'center' });
    y += 18;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(STEEL)
      .text('Contrato / liquidación a proveedor', M, y, {
        width: CW,
        align: 'center',
      });
    y += 16;
    doc
      .moveTo(M, y)
      .lineTo(M + CW, y)
      .strokeColor(LINE)
      .stroke();
    y += 14;

    y = this.section(doc, y, 'Datos del transportista');
    const t = liq.transportista;
    y = this.grid(doc, y, [
      ['Nombre', dash(t?.nombre)],
      ['CUIT / RUT', dash(t?.idFiscal)],
      ['Domicilio', dash(t?.domicilio)],
      ['Lugar', dash(t?.pais)],
    ]);

    y = this.section(doc, y, 'Período');
    y = this.grid(doc, y, [
      [
        'Desde',
        fmtContratoDate(liq.periodoDesde),
      ],
      ['Hasta', fmtContratoDate(liq.periodoHasta)],
      ['Cantidad de viajes', String(totales.cantViajes || liq.cantViajes)],
      ['Moneda', totales.moneda],
    ]);

    if (totales.cantViajes === 1 && totales.grupos[0]?.viajes[0]) {
      this.drawViajeUnico(doc, y, totales.grupos[0].viajes[0], totales, unidad);
      return;
    }
    if (totales.mismoPrecio) {
      this.drawViajesMismoPrecio(doc, y, totales, unidad);
      return;
    }
    y = this.drawViajesPorPrecio(doc, y, totales, unidad);
    y = this.ensure(doc, y, 90);
    y = this.section(doc, y, 'Total consolidado');
    this.moneyRows(
      doc,
      y,
      [
        ['Subtotal', fmtMoney(totales.subtotal, totales.moneda)],
        [`IVA ${this.pctLabel(totales.ivaPct)}`, fmtMoney(totales.iva, totales.moneda)],
        ['Adelanto', fmtMoney(totales.adelanto, totales.moneda)],
        ['Total flete', fmtMoney(totales.totalFlete, totales.moneda)],
      ],
      true,
    );
  }

  private drawViajeUnico(
    doc: PDFKit.PDFDocument,
    y: number,
    v: LiquidacionContratoViajeInput,
    totales: LiquidacionContratoTotales,
    unidad: UnidadCantidad,
  ): number {
    y = this.section(doc, y, 'Datos del viaje');
    y = this.grid(doc, y, [
      ['Lugar de carga', dash(v.origen)],
      ['Fecha de carga', fmtContratoDate(v.fechaCarga)],
      ['Lugar de descarga', dash(v.destino)],
      ['Fecha de descarga', fmtContratoDate(v.fechaDescarga)],
      ['Chofer', dash(v.choferNombre)],
      ['Mercadería', dash(v.mercaderia)],
      ['CRT N°', dash(v.crt)],
      ['MIC N°', dash(v.mic)],
      ['Remito N°', dash(v.remito)],
      [`Cantidad de ${unidadCantidadPlural(unidad)}`, fmtNum(v.toneladas)],
      ...(v.idPropio2Label && v.idPropio2Valor
        ? [[v.idPropio2Label, v.idPropio2Valor] as [string, string]]
        : []),
    ]);
    y = this.section(doc, y, 'Flete contratado');
    y = this.grid(doc, y, [
      ['Origen', dash(v.origen)],
      ['Destino', dash(v.destino)],
    ]);
    y = this.section(doc, y, 'Detalle de flete');
    y = this.moneyRows(doc, y, [
      [`Valor acordado x ${unidad}`, v.precioPorTn != null ? fmtMoney(v.precioPorTn, v.moneda) : '—'],
      ['Subtotal', fmtMoney(v.subtotal, v.moneda)],
      [`IVA ${this.pctLabel(totales.ivaPct)}`, fmtMoney(totales.iva, totales.moneda)],
      ['Adelanto', fmtMoney(v.adelanto, v.moneda)],
      ['Total flete', fmtMoney(totales.totalFlete, totales.moneda)],
      ['Moneda', v.moneda],
    ], true);
    return y;
  }

  private drawViajesMismoPrecio(
    doc: PDFKit.PDFDocument,
    y: number,
    totales: LiquidacionContratoTotales,
    unidad: UnidadCantidad,
  ): number {
    const g = totales.grupos[0];
    y = this.section(doc, y, 'Viajes incluidos');
    y = this.drawViajesTabla(doc, y, g.viajes, unidad);
    y = this.section(doc, y, 'Flete contratado');
    const origenes = [...new Set(g.viajes.map((v) => dash(v.origen)))].join(' / ');
    const destinos = [...new Set(g.viajes.map((v) => dash(v.destino)))].join(' / ');
    y = this.grid(doc, y, [
      ['Origen', origenes],
      ['Destino', destinos],
    ]);
    y = this.section(doc, y, 'Detalle de flete');
    y = this.moneyRows(doc, y, [
      [
        `Valor acordado x ${unidad}`,
        g.precioPorTn != null ? fmtMoney(g.precioPorTn, totales.moneda) : '—',
      ],
      [capitalizar(unidadCantidadPlural(unidad)), fmtNum(g.toneladas)],
      ['Subtotal', fmtMoney(g.subtotal, totales.moneda)],
      [`IVA ${this.pctLabel(totales.ivaPct)}`, fmtMoney(totales.iva, totales.moneda)],
      ['Adelanto', fmtMoney(g.adelanto, totales.moneda)],
      ['Total flete', fmtMoney(totales.totalFlete, totales.moneda)],
      ['Moneda', totales.moneda],
    ], true);
    return y;
  }

  private drawViajesPorPrecio(
    doc: PDFKit.PDFDocument,
    y: number,
    totales: LiquidacionContratoTotales,
    unidad: UnidadCantidad,
  ): number {
    for (const g of totales.grupos) {
      const titulo =
        g.precioPorTn != null
          ? `Viajes a ${fmtMoney(g.precioPorTn, totales.moneda)} x ${unidad}`
          : `Viajes sin precio x ${unidad}`;
      y = this.section(doc, y, titulo);
      y = this.drawViajesTabla(doc, y, g.viajes, unidad);
      y = this.moneyRows(doc, y, [
        [capitalizar(unidadCantidadPlural(unidad)), fmtNum(g.toneladas)],
        ['Subtotal del grupo', fmtMoney(g.subtotal, totales.moneda)],
      ]);
    }
    return y;
  }

  private drawViajesTabla(
    doc: PDFKit.PDFDocument,
    y: number,
    viajes: LiquidacionContratoViajeInput[],
    unidad: UnidadCantidad,
  ): number {
    for (const v of viajes) {
      y = this.ensure(doc, y, 72);
      const line = [
        `#${v.numero}`,
        `${fmtContratoDate(v.fechaCarga)} ${dash(v.origen)} → ${fmtContratoDate(v.fechaDescarga)} ${dash(v.destino)}`,
      ].join('  ·  ');
      doc.font('Helvetica-Bold').fontSize(8).fillColor(CHARCOAL).text(line, M, y, { width: CW });
      y += 12;
      const idPropio2Segmento =
        v.idPropio2Label && v.idPropio2Valor
          ? `  ·  ${v.idPropio2Label}: ${v.idPropio2Valor}`
          : '';
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(STEEL)
        .text(
          `Chofer: ${dash(v.choferNombre)}  ·  Mercadería: ${dash(v.mercaderia)}  ·  ${unidad}: ${fmtNum(v.toneladas)}${idPropio2Segmento}`,
          M,
          y,
          { width: CW },
        );
      y += 11;
      doc.text(
        `CRT: ${dash(v.crt)}  ·  MIC: ${dash(v.mic)}  ·  Remito: ${dash(v.remito)}`,
        M,
        y,
        { width: CW },
      );
      y += 16;
    }
    return y;
  }

  private section(doc: PDFKit.PDFDocument, y: number, title: string): number {
    y = this.ensure(doc, y, 28);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(CHARCOAL).text(title.toUpperCase(), M, y);
    y += 12;
    doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(LINE).stroke();
    return y + 8;
  }

  private grid(
    doc: PDFKit.PDFDocument,
    y: number,
    pairs: [string, string][],
  ): number {
    const colW = CW / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      y = this.ensure(doc, y, 28);
      this.kv(doc, M, y, pairs[i][0], pairs[i][1], colW - 8);
      if (pairs[i + 1]) {
        this.kv(doc, M + colW, y, pairs[i + 1][0], pairs[i + 1][1], colW - 8);
      }
      y += 26;
    }
    return y + 4;
  }

  private kv(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    label: string,
    value: string,
    w: number,
  ) {
    doc.font('Helvetica').fontSize(7).fillColor(STEEL).text(label.toUpperCase(), x, y, { width: w });
    doc.font('Helvetica').fontSize(9).fillColor(CHARCOAL).text(value, x, y + 10, { width: w });
  }

  private moneyRows(
    doc: PDFKit.PDFDocument,
    y: number,
    rows: [string, string][],
    lastBold = false,
  ): number {
    for (let i = 0; i < rows.length; i++) {
      y = this.ensure(doc, y, 16);
      const bold = lastBold && i === rows.length - 1;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(CHARCOAL);
      doc.text(rows[i][0], M, y, { width: CW - 140 });
      doc.text(rows[i][1], M + CW - 140, y, { width: 140, align: 'right' });
      y += 14;
    }
    return y + 8;
  }

  private pctLabel(pct: number): string {
    if (Number.isInteger(pct) || Math.abs(pct - Math.round(pct)) < 1e-9) {
      return `${Math.round(pct)}%`;
    }
    return `${pct.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
  }

  private ensure(doc: PDFKit.PDFDocument, y: number, need: number): number {
    if (y + need < 780) return y;
    doc.addPage();
    return M;
  }
}
