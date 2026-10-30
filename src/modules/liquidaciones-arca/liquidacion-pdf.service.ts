import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import * as PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ArcaConfigService } from "./arca-config.service";
import { buildComprobanteCvlp } from "./arca-cvlp.util";
import { cvlpPdfPieFinanciero, resolveIvaPct } from "./arca-iva.util";
import { buildCvlpConceptosList } from "./cvlp-conceptos.util";
import { round2 } from "./arca-iva.util";
import { CBTE_TIPO_NC_CVLP, esNotaDebitoAnulacion } from "./arca.util";
import {
  drawHomologacionWatermark,
  shouldShowHomologacionWatermark,
} from "./pdf-homologacion-watermark";
import { pdfColoresComprobante } from "./pdf-color-comprobante";
import { ArcaComprobanteCvlp } from "./types/arca.types";
import { normalizeUnidadCantidad } from "./cantidad-unidad.util";
import { ymdAr } from "../../shared/util/fecha-ar.util";
import {
  nombreArchivoComprobante,
  tipoComprobanteLegible,
} from "../../shared/util/nombre-archivo-comprobante.util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

type TenantPdfConfig = {
  idPropio2Habilitado: boolean;
  idPropio2Label: string | null;
  unidadCantidadViajes: string;
  idPropio1Habilitado: boolean;
  labelIdentificacionPersonalizadaViajes: string | null;
  productoLabel: string | null;
  productoLabelPlural: string | null;
} | null;

type PdfCbteAsoc = { tipo: number; ptoVenta: number; nro: number };

type PdfDrawOpts = {
  kind: "cvlp" | "nc";
  title: string;
  cbteTipo: number;
  cbteNro: number | null;
  ptoVenta: number | null;
  cae: string | null;
  caeFechaVto: Date | null;
  fecha: Date;
  asociados?: PdfCbteAsoc[];
};

// Letra del recuadro del comprobante: CVLP 60 y sus anulaciones NC 3 / ND 2 son clase A;
// 61, NC 8 y ND 7, clase B.
const LETRA_POR_TIPO: Record<number, string> = {
  1: "A",
  2: "A",
  3: "A",
  6: "B",
  7: "B",
  8: "B",
  11: "C",
  60: "A",
  61: "B",
};

function letraComprobante(cbteTipo: number): string {
  return LETRA_POR_TIPO[cbteTipo] ?? "A";
}

const CONDICION_IVA_TEXTO: Record<number, string> = {
  1: "Responsable Inscripto",
  4: "IVA Sujeto Exento",
  5: "Consumidor Final",
  6: "Responsable Monotributo",
};

function condicionIvaTexto(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  return CONDICION_IVA_TEXTO[Number(v)] ?? String(v);
}

/** "30716741792" → "30-71674179-2"; cualquier otro formato se muestra tal cual. */
function formatCuit(v: string | null | undefined): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(v ?? "");
}

type ViajeDetalleCvlp = {
  numero: string | number;
  numeroIdentificacionPersonalizado?: string | null;
  idPropio2?: string | null;
  origen?: string | null;
  destino?: string | null;
  chofer?: { nombre?: string | null } | null;
  observaciones?: string | null;
  productosViaje?: Array<{ producto?: { nombre?: string | null } | null }>;
};

/** Identificación del viaje: "CTG 101…-CP 0-1761" (ID propio + ID propio 2) o "Viaje #N". */
function refViajeCvlp(v: ViajeDetalleCvlp, tenant: TenantPdfConfig): string {
  const idPropio = v.numeroIdentificacionPersonalizado?.trim();
  const usaIdPropio = (tenant?.idPropio1Habilitado ?? true) && Boolean(idPropio);
  let ref = usaIdPropio
    ? `${tenant?.labelIdentificacionPersonalizadaViajes?.trim() || "ID propio"} ${idPropio}`
    : `Viaje #${v.numero}`;
  const id2 = v.idPropio2?.trim();
  if (tenant?.idPropio2Habilitado && id2) {
    ref += `-${tenant.idPropio2Label?.trim() || "ID Propio 2"} ${id2}`;
  }
  return ref;
}

/**
 * Detalle de una línea de viaje del CVLP: "Chofer — CTG 101…-CP 0-1761 — Origen a Destino —
 * Producto" (cada parte solo si tiene dato). Espejo en el front: `detalleViajeCvlp` de
 * `lib/pdfDetalleViaje.ts`.
 */
function detalleViajeCvlp(v: ViajeDetalleCvlp, tenant: TenantPdfConfig): string {
  const ruta = [v.origen?.trim(), v.destino?.trim()].filter(Boolean).join(" a ");
  const productos = (v.productosViaje ?? [])
    .map((p) => p.producto?.nombre?.trim())
    .filter(Boolean)
    .join(", ");
  const detalle = [v.chofer?.nombre?.trim(), refViajeCvlp(v, tenant), ruta, productos]
    .filter(Boolean)
    .join(" — ");
  // Observaciones del viaje en un renglón aparte, debajo del detalle (pedido NyM, oct 2026).
  const obs = v.observaciones?.trim();
  return obs ? `${detalle}\nObs.: ${obs}` : detalle;
}

// ── Helpers numéricos ─────────────────────────────────────────────────────────

function fmtNum(n: number, decimals = 2): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

const UNIDADES = [
  "",
  "UN",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISÉIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
];
// El 20 se escribe como palabra única igual que el 11-19 ("veintiuno", no "veinte y uno").
const VEINTES = [
  "VEINTE",
  "VEINTIUNO",
  "VEINTIDÓS",
  "VEINTITRÉS",
  "VEINTICUATRO",
  "VEINTICINCO",
  "VEINTISÉIS",
  "VEINTISIETE",
  "VEINTIOCHO",
  "VEINTINUEVE",
];
const DECENAS = [
  "",
  "DIEZ",
  "VEINTE",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];
const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

function dosDigitos(n: number): string {
  if (n === 0) return "";
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 2) return VEINTES[u];
  if (u === 0) return DECENAS[d];
  return `${DECENAS[d]} Y ${UNIDADES[u]}`;
}

function tresDigitos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const centStr = c > 0 ? CENTENAS[c] : "";
  return [centStr, dosDigitos(resto)].filter(Boolean).join(" ");
}

function numeroALetras(n: number): string {
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const centavosStr = centavos === 0 ? "CERO" : dosDigitos(centavos);

  if (entero === 0) return `CERO CON ${centavosStr} CENTAVO(S)`;

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];
  if (millones > 0)
    partes.push(
      `${tresDigitos(millones)} ${millones === 1 ? "MILLÓN" : "MILLONES"}`,
    );
  if (miles > 0)
    partes.push(`${miles === 1 ? "MIL" : `${tresDigitos(miles)} MIL`}`);
  if (resto > 0) partes.push(tresDigitos(resto));

  const letras = partes.join(" ");
  return `${letras} CON ${centavosStr} CENTAVO(S)`;
}

// ── PDF builder ───────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const COL_W = PAGE_W - MARGIN * 2;

@Injectable()
export class LiquidacionPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arcaConfig: ArcaConfigService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  async generate(
    tenantId: string,
    liquidacionId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.generateInternal(tenantId, liquidacionId, "cvlp");
  }

  /** PDF del comprobante de anulación (Nota de Crédito o Nota de Débito), con comprobantes asociados en el detalle. */
  async generateNotaCredito(
    tenantId: string,
    liquidacionId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.generateInternal(tenantId, liquidacionId, "nc");
  }

  private async generateInternal(
    tenantId: string,
    liquidacionId: string,
    kind: "cvlp" | "nc",
  ): Promise<{ buffer: Buffer; filename: string }> {
    const liq = await this.db.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: {
        transportista: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            condicionIva: true,
            domicilio: true,
            pais: true,
          },
        },
        viajes: {
          include: {
            viaje: {
              select: {
                id: true,
                numero: true,
                fechaCarga: true,
                fechaDescarga: true,
                origen: true,
                destino: true,
                cantidadTransportista: true,
                precioUnitarioTransportista: true,
                precioTransportistaExterno: true,
                precioTransportistaIvaIncluidoPct: true,
                cliente: {
                  select: {
                    id: true,
                    nombre: true,
                    idFiscal: true,
                    direccion: true,
                  },
                },
                chofer: { select: { nombre: true } },
                observaciones: true,
                numeroIdentificacionPersonalizado: true,
                idPropio2: true,
                productosViaje: {
                  select: { producto: { select: { nombre: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException("Liquidación no encontrada");
    }

    const tenantIdPropio2 = await this.db.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: {
        idPropio2Habilitado: true,
        idPropio2Label: true,
        unidadCantidadViajes: true,
        idPropio1Habilitado: true,
        labelIdentificacionPersonalizadaViajes: true,
        productoLabel: true,
        productoLabelPlural: true,
      },
    });

    if (kind === "nc") {
      if (
        liq.estado !== "anulado" ||
        !liq.anulacionCae ||
        !liq.anulacionCbteNro
      ) {
        throw new BadRequestException(
          "No hay comprobante de anulación para esta liquidación.",
        );
      }
    }

    const drawOpts: PdfDrawOpts =
      kind === "nc"
        ? {
            kind: "nc",
            title: esNotaDebitoAnulacion(liq.anulacionCbteTipo)
              ? "NOTA DE DEBITO - CUENTA DE VENTA Y LIQUIDO PRODUCTO"
              : "NOTA DE CREDITO - CUENTA DE VENTA Y LIQUIDO PRODUCTO",
            cbteTipo: liq.anulacionCbteTipo ?? CBTE_TIPO_NC_CVLP,
            cbteNro: liq.anulacionCbteNro,
            ptoVenta: liq.anulacionPtoVenta ?? liq.ptoVenta,
            cae: liq.anulacionCae,
            caeFechaVto: liq.anulacionCaeFechaVto,
            fecha: liq.anulacionFecha ?? liq.updatedAt,
            asociados:
              liq.cbteNro != null && liq.ptoVenta != null
                ? [
                    {
                      tipo: liq.cbteTipo,
                      ptoVenta: liq.ptoVenta,
                      nro: liq.cbteNro,
                    },
                  ]
                : [],
          }
        : {
            kind: "cvlp",
            title: "CUENTA DE VENTA Y LIQUIDO PRODUCTO",
            cbteTipo: liq.cbteTipo,
            cbteNro: liq.cbteNro,
            ptoVenta: liq.ptoVenta,
            cae: liq.cae,
            caeFechaVto: liq.caeFechaVto,
            fecha: liq.createdAt,
          };

    const config = await this.arcaConfig.findParaComprobante(tenantId);

    // QR solo si tiene CAE
    let qrBuffer: Buffer | null = null;
    if (drawOpts.cae && drawOpts.cbteNro && drawOpts.ptoVenta) {
      const cuitNum = Number(
        String(liq.transportista?.idFiscal ?? "0").replace(/-/g, ""),
      );
      const payload = {
        ver: 1,
        fecha: drawOpts.fecha.toISOString().slice(0, 10),
        cuit: Number(String(config?.cuitEmisor ?? "0").replace(/-/g, "")),
        ptoVta: drawOpts.ptoVenta,
        tipoCmp: drawOpts.cbteTipo,
        nroCmp: drawOpts.cbteNro,
        importe: Math.round(liq.liquido * 100) / 100,
        moneda: "PES",
        ctz: 1,
        tipoDocRec: 80,
        nroDocRec: cuitNum,
        tipoCodAut: "E",
        codAut: Number(drawOpts.cae),
      };
      const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
      qrBuffer = (await QRCode.toBuffer(qrUrl, {
        width: 72,
        margin: 1,
      })) as Buffer;
    }

    // Logo del emisor, descargado una sola vez (se reutiliza en ORIGINAL y DUPLICADO)
    let logoBuffer: Buffer | null = null;
    if (config?.logoUrl) {
      try {
        const fetched = await fetch(config.logoUrl);
        if (fetched.ok) logoBuffer = Buffer.from(await fetched.arrayBuffer());
      } catch (e) {
        console.error("LOGO ERROR:", e);
        // Si el logo no se puede descargar, el PDF se genera igual sin él.
      }
    }

    let cvlp: ArcaComprobanteCvlp;
    if (drawOpts.cae) {
      const logs = await this.db.arcaLog.findMany({
        where: { liquidacionId, exitoso: true, method: "FECAESolicitar" },
        orderBy: { createdAt: kind === "nc" ? "desc" : "asc" },
        take: 5,
      });
      for (const log of logs) {
        const metadata = (log.requestBody as any)?.auditMetadata;
        if (!metadata || !Array.isArray(metadata.items)) continue;
        const metaTipo = Number(metadata.cbteTipo);
        if (metaTipo && metaTipo !== drawOpts.cbteTipo) continue;
        cvlp = {
          ...metadata,
          cbteTipo: drawOpts.cbteTipo,
          cbteNro: drawOpts.cbteNro ?? metadata.cbteNro,
          ptoVenta: drawOpts.ptoVenta ?? metadata.ptoVenta,
          items: metadata.items,
        };
        break;
      }
    }

    // Si no está autorizada o no se encontró el log, se reconstruye al vuelo para el borrador
    if (!cvlp) {
      const lineasDb = await this.db.liquidacionConceptoLinea.findMany({
        where: { liquidacionId },
        orderBy: { orden: "asc" },
      });
      const ivaDefault = resolveIvaPct(
        (liq as { ivaPct?: number | null }).ivaPct ?? config?.ivaGastosAdmin,
      );
      
      const viajesPayload = liq.viajes.map((v) => {
        const tnDestino = v.viaje.cantidadTransportista ?? null;
        const tarifaTransportista = v.viaje.precioUnitarioTransportista ?? null;
        const subtotal = tnDestino != null && tarifaTransportista != null
          ? round2(tnDestino * tarifaTransportista)
          : round2(v.viaje.precioTransportistaExterno ?? 0);
        return {
          id: v.viajeId,
          numero: v.viaje.numero ?? '',
          bruto: subtotal,
          comision: round2(subtotal * liq.comisionPct / 100),
          ivaPct: v.viaje.precioTransportistaIvaIncluidoPct || undefined,
        };
      });

      const conceptos = buildCvlpConceptosList({
        bruto: liq.bruto,
        comision: liq.comision,
        ivaPctDefault: ivaDefault,
        viajes: viajesPayload,
        lineas: (lineasDb ?? []).map(
          (r: {
            nombreSnapshot: string;
            signo: string;
            ivaPct: number;
            monto: number;
            cantidad?: number | null;
            montoUnitario?: number | null;
            orden?: number;
            modoAplicacion?: string;
            viajeId?: string | null;
            detalle?: string | null;
          }) => ({
            nombreSnapshot: r.nombreSnapshot,
            signo: r.signo as "favor" | "contra",
            ivaPct: r.ivaPct,
            monto: r.monto,
            cantidad: r.cantidad ?? 1,
            montoUnitario: r.montoUnitario ?? null,
            orden: r.orden,
            modoAplicacion: r.modoAplicacion,
            viajeId: r.viajeId,
            detalle: r.detalle ?? null,
          }),
        ),
      });

      const docNro = liq.transportista?.idFiscal
        ? Number(liq.transportista.idFiscal.replace(/-/g, ""))
        : 0;
      const docTipo = docNro ? 80 : 99;

      const baseCabecera = {
        cuit: config?.cuitEmisor ?? "",
        ptoVenta: drawOpts.ptoVenta ?? config?.ptoVentaCvlp ?? 0,
        cbteTipo: drawOpts.cbteTipo,
        cbteNro: drawOpts.cbteNro ?? 0,
        fechaCbte: drawOpts.fecha.toISOString().slice(0, 10).replace(/-/g, ""),
        concepto: 1,
        docTipo,
        docNro,
        condicionIvaReceptorId: liq.transportista?.condicionIva ?? 1,
      };

      cvlp = buildComprobanteCvlp(baseCabecera, conceptos, ivaDefault);
    }

    const pctComision = liq.comisionPct ?? liq.porcentajeComision;

    if (cvlp && cvlp.items) {
      cvlp.items = cvlp.items.map((item) => {
        const match = item.descripcion.match(
          /^(COMISIÓ?N)(?:\s*\(Viaje #([^)]+)\))?$/i,
        );

        if (match) {
          const viajeSufijo = match[2] ? ` (Viaje #${match[2]})` : "";

          const nuevaDescripcion =
            pctComision != null
              ? `Comisión Transporte - ${pctComision}%${viajeSufijo}`
              : `Comisión Transporte${viajeSufijo}`;

          return {
            ...item,
            descripcion: nuevaDescripcion,
          };
        }
        return item;
      });
    }

    const buffer = await this.buildPdf(
      liq,
      config,
      qrBuffer,
      logoBuffer,
      cvlp,
      drawOpts,
      tenantIdPropio2,
    );

    // Con NC/ND (`kind === "nc"`) `drawOpts.cbteTipo` ya es el de la anulación (2/3/7/8).
    const filename = nombreArchivoComprobante(
      tipoComprobanteLegible(drawOpts.cbteTipo),
      drawOpts.ptoVenta,
      drawOpts.cbteNro,
      liquidacionId.slice(0, 8),
    );

    return { buffer, filename };
  }

  private buildPdf(
    liq: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    logoBuffer: Buffer | null,
    cvlp: ArcaComprobanteCvlp,
    drawOpts: PdfDrawOpts,
    tenantIdPropio2: TenantPdfConfig = null,
  ): Promise<Buffer> {
    // Ambiente desde ArcaConfig del tenant (no acción manual del usuario).
    const showTestWatermark = shouldShowHomologacionWatermark(config?.ambiente);
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 0,
          autoFirstPage: true,
        });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        this.draw(
          doc,
          liq,
          config,
          qrBuffer,
          logoBuffer,
          "ORIGINAL",
          cvlp,
          drawOpts,
          showTestWatermark,
          tenantIdPropio2,
        );
        doc.addPage();
        this.draw(
          doc,
          liq,
          config,
          qrBuffer,
          logoBuffer,
          "DUPLICADO",
          cvlp,
          drawOpts,
          showTestWatermark,
          tenantIdPropio2,
        );
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private draw(
    doc: PDFKit.PDFDocument,
    liq: PrismaAny,
    config: PrismaAny,
    qrBuffer: Buffer | null,
    logoBuffer: Buffer | null,
    copia: "ORIGINAL" | "DUPLICADO",
    cvlp: ArcaComprobanteCvlp,
    opts: PdfDrawOpts,
    showTestWatermark = false,
    tenantIdPropio2: TenantPdfConfig = null,
  ) {
    const M = MARGIN;
    const CW = COL_W;
    let y = M;
    // Color de acento elegido por la empresa (ArcaConfig.colorLiquidacion); sin color, los grises de siempre.
    const col = pdfColoresComprobante(config?.colorLiquidacion);

    // ── Barra superior ORIGINAL/DUPLICADO (caja con borde, sin relleno) ───────
    doc.rect(M, y, CW, 18).stroke(col.linea("#000"));
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(col.texto("#000"))
      .text(copia, M, y + 5, { width: CW, align: "center" });
    y += 22;

    // ── Sección 1: logo | emisor | letra | comprobante (recuadro redondeado) ──
    const hdrH = 112;
    const R = 6;
    doc.roundedRect(M, y, CW, hdrH, R).stroke(col.linea("#555"));

    const hasLogo = Boolean(logoBuffer);
    const logoW = hasLogo ? 134 : 0;
    const letraX = M + 290; // columna de la letra
    const letraW = 46;
    const compX = letraX + letraW; // columna del comprobante
    const compW = M + CW - compX;
    const emisorX = M + logoW;
    const emisorW = letraX - emisorX;

    if (hasLogo) doc.moveTo(emisorX, y).lineTo(emisorX, y + hdrH).stroke(col.linea("#555"));
    doc.moveTo(letraX, y).lineTo(letraX, y + hdrH).stroke(col.linea("#555"));
    doc.moveTo(compX, y).lineTo(compX, y + hdrH).stroke(col.linea("#555"));

    // Logo
    let logoOk = false;
    if (hasLogo) {
      try {
        doc.image(logoBuffer as Buffer, M + 8, y + 8, {
          fit: [logoW - 16, hdrH - 16],
          align: "center",
          valign: "center",
        });
        logoOk = true;
      } catch (e) {
        console.error("LOGO ERROR:", e);
        // Formato de imagen no soportado por pdfkit; se sigue sin logo.
      }
    }

    // Emisor: razón social, domicilio y, al pie, la condición frente al IVA.
    {
      const x = emisorX + 10;
      const w = emisorW - 18;
      const emisor = config?.razonSocial ?? "";
      const emisorTxt = logoOk ? `de ${emisor}` : emisor;
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor("#000")
        .text(emisorTxt, x, y + 14, { width: w });
      const cy = y + 14 + doc.heightOfString(emisorTxt, { width: w }) + 8;
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#222")
        .text(config?.domicilioEmisor ?? "", x, cy, { width: w, lineGap: 3 });
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#222")
        .text(`I.V.A.: ${condicionIvaTexto(config?.condicionIvaEmisor)}`, x, y + hdrH - 22, {
          width: w,
        });
    }

    // Letra + código del comprobante
    {
      const box = 30;
      const bx = letraX + (letraW - box) / 2;
      doc.rect(bx, y + 10, box, box).stroke(col.linea("#000"));
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .fillColor(col.texto("#000"))
        .text(letraComprobante(opts.cbteTipo), bx, y + 16, { width: box, align: "center" });
      doc
        .fontSize(6.5)
        .font("Helvetica")
        .fillColor("#000")
        .text("Cod.", letraX, y + 44, { width: letraW, align: "center" })
        .text(`N° ${String(opts.cbteTipo).padStart(2, "0")}`, letraX, y + 52, {
          width: letraW,
          align: "center",
        });
    }

    // Comprobante: título, número, datos fiscales del emisor y fecha en casillas.
    {
      const x = compX + 10;
      const w = compW - 20;
      doc
        .fontSize(opts.kind === "nc" ? 7.5 : 8.5)
        .font("Helvetica-Bold")
        .fillColor(col.texto("#000"))
        .text(opts.title, x, y + 10, { width: w, align: "center" });
      const tituloH = doc.heightOfString(opts.title, { width: w });

      const cbteNroStr = opts.cbteNro
        ? `${String(opts.ptoVenta).padStart(4, "0")} - ${String(opts.cbteNro).padStart(8, "0")}`
        : "BORRADOR";
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(cbteNroStr, x, y + 14 + tituloH, { width: w, align: "center" });

      const datosY = y + 54;
      const datosW = w - 78; // a la derecha quedan las casillas de la fecha
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#222")
        .text(`C.U.I.T. Nº ${formatCuit(config?.cuitEmisor)}`, x, datosY, { width: datosW })
        .text(`Ingresos Brutos: ${config?.ingBrutos ?? config?.cuitEmisor ?? ""}`, x, datosY + 13, {
          width: datosW,
        })
        .text(`Inicio de Act.: ${config?.inicActEmisor ?? ""}`, x, datosY + 26, { width: datosW });

      const [anio, mes, dia] = ymdAr(opts.fecha).split("-");
      const celdas: [string, string][] = [
        ["DIA", dia],
        ["MES", mes],
        ["AÑO", anio.slice(2)],
      ];
      const cw = 24;
      const ch = 24;
      const fx = x + w - cw * celdas.length;
      const fy = y + hdrH - ch - 8;
      celdas.forEach(([label, valor], i) => {
        const cx0 = fx + i * cw;
        doc.rect(cx0, fy, cw, ch).stroke(col.linea("#555"));
        doc.moveTo(cx0, fy + 10).lineTo(cx0 + cw, fy + 10).stroke(col.linea("#555"));
        doc
          .fontSize(5.5)
          .font("Helvetica-Bold")
          .fillColor("#000")
          .text(label, cx0, fy + 3, { width: cw, align: "center" });
        doc
          .fontSize(7.5)
          .font("Helvetica")
          .text(valor, cx0, fy + 13, { width: cw, align: "center" });
      });
    }

    y += hdrH + 8;

    // ── Sección 2: receptor (transportista) ──────────────────────────────────
    {
      const t = liq.transportista;
      const x = M + 12;
      const w = CW - 24;
      const cuit = `C.U.I.T. Nº ${formatCuit(t?.idFiscal)}`;
      doc.fontSize(8.5).font("Helvetica");
      const cuitW = doc.widthOfString(cuit) + 4;
      const domicilio = `Domicilio: ${t?.domicilio ?? ""}`;
      const domW = w - cuitW - 16;
      const domH = doc.heightOfString(domicilio, { width: domW });
      const rcpH = 12 + 12 + 10 + domH + 12;

      doc.roundedRect(M, y, CW, rcpH, R).stroke(col.linea("#555"));
      doc.fillColor("#000").text(`Señor/es: ${t?.nombre ?? ""}`, x, y + 12, { width: w });
      const domY = y + 12 + 12 + 10;
      doc.text(domicilio, x, domY, { width: domW });
      doc.text(cuit, x + w - cuitW, domY, { width: cuitW, align: "right" });
      y += rcpH + 6;
    }

    // ── Sección 3: IVA del receptor y condiciones de venta ───────────────────
    {
      const boxH = 28;
      doc.roundedRect(M, y, CW, boxH, R).stroke(col.linea("#555"));
      doc
        .fontSize(8.5)
        .font("Helvetica")
        .fillColor("#000")
        .text(`I.V.A.: ${condicionIvaTexto(liq.transportista?.condicionIva)}`, M + 12, y + 10, {
          width: CW / 2 - 24,
        })
        .text("Condiciones de Venta: Cuenta Corriente", M + CW / 2, y + 10, {
          width: CW / 2 - 12,
        });
      y += boxH + 12;
    }

    doc
      .fontSize(8.5)
      .font("Helvetica")
      .fillColor("#000")
      .text(
        opts.kind === "nc"
          ? "Anulación de la cuenta de venta y líquido producto según el siguiente detalle:"
          : "Monto total FACTURADO por fletes realizados por su cuenta y orden según el siguiente detalle:",
        M + 6,
        y,
        { width: CW - 12 },
      );
    y += 18;

    // ── Tabla: Cantidad | Detalle | Tarifa | IVA % | Importe ─────────────────
    const footerY = PAGE_H - MARGIN - 90;
    const colWidths = [62, CW - 62 - 72 - 40 - 80, 72, 40, 80];
    const tHeaders = ["Cantidad", "Detalle", "Tarifa", "IVA %", "Importe"];
    const aligns = ["left", "left", "right", "right", "right"] as const;
    const colX: number[] = [];
    let cx = M;
    for (const w of colWidths) {
      colX.push(cx);
      cx += w;
    }
    const FILA_FONT = 7;

    const drawHeader = () => {
      tHeaders.forEach((h, i) => {
        doc
          .fontSize(8)
          .font("Helvetica-Bold")
          .fillColor(col.texto("#000"))
          .text(h, colX[i] + 4, y, { width: colWidths[i] - 8, align: aligns[i] });
      });
      y += 13;
      doc.moveTo(M, y).lineTo(M + CW, y).stroke(col.linea("#000"));
      y += 8;
    };

    const drawFila = (cells: string[]) => {
      doc.fontSize(FILA_FONT).font("Helvetica");
      const rowH =
        Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: colWidths[i] - 8 }))) + 9;
      if (y + rowH > footerY - 5) {
        doc.addPage();
        if (showTestWatermark) drawHomologacionWatermark(doc);
        y = M;
        drawHeader();
      }
      cells.forEach((text, i) => {
        doc
          .fontSize(FILA_FONT)
          .font("Helvetica")
          .fillColor("#000")
          .text(text, colX[i] + 4, y, { width: colWidths[i] - 8, align: aligns[i] });
      });
      y += rowH;
    };

    drawHeader();

    const unidad = normalizeUnidadCantidad(tenantIdPropio2?.unidadCantidadViajes);
    for (const item of cvlp.items) {
      if (!item.descripcion.toUpperCase().startsWith("FLETES") || !(liq.viajes?.length > 0)) {
        continue;
      }
      for (const lViaje of liq.viajes) {
        const tripIva =
          lViaje.viaje.precioTransportistaIvaIncluidoPct ||
          resolveIvaPct((liq as any).ivaPct ?? config?.ivaGastosAdmin);
        if (tripIva !== item.ivaPct) continue;
        const base = lViaje.subtotal ?? 0;
        drawFila([
          lViaje.tnDestino != null ? `${fmtNum(lViaje.tnDestino)} ${unidad}` : "1,00",
          detalleViajeCvlp(lViaje.viaje, tenantIdPropio2),
          fmtNum(lViaje.tarifaTransportista ?? base),
          fmtNum(item.ivaPct),
          fmtNum(base),
        ]);
      }
    }

    // Conceptos (comisión, gastos, etc.): agrupados por nombre; si se repiten con el
    // mismo importe en varios viajes se consolidan en una línea "N x importe".
    const otrosItems = cvlp.items.filter(
      (i) => !i.descripcion.toUpperCase().startsWith("FLETES"),
    );
    const gruposOtros: { [baseName: string]: typeof otrosItems } = {};
    for (const item of otrosItems) {
      const match = item.descripcion.match(/^(.*?)\s*\(Viaje #([^)]+)\)$/i);
      const baseName = match
        ? match[1].trim().toUpperCase()
        : item.descripcion.toUpperCase();
      if (!gruposOtros[baseName]) gruposOtros[baseName] = [];
      gruposOtros[baseName].push(item);
    }

    for (const baseName in gruposOtros) {
      const group = gruposOtros[baseName];
      const allSameAmount = group.every((i) => i.importeBase === group[0].importeBase);
      if (group.length > 1 && allSameAmount) {
        const unit = group[0].importeBase;
        drawFila([
          fmtNum(group.length, 0),
          `${baseName} — ${group.length} x ${fmtNum(unit)}`,
          fmtNum(unit),
          fmtNum(group[0].ivaPct),
          fmtNum(group.reduce((acc, i) => acc + i.importeBase, 0)),
        ]);
        continue;
      }
      for (const item of group) {
        const match = item.descripcion.match(/^(.*?)\s*\(Viaje #([^)]+)\)$/i);
        let detalle = baseName;
        if (match) {
          const internalId = match[2].trim();
          const lv = liq.viajes?.find((x) => String(x.viaje.numero) === internalId);
          detalle = `${baseName} — ${lv ? refViajeCvlp(lv.viaje, tenantIdPropio2) : `Viaje #${internalId}`}`;
        }
        const qty = item.cantidad ?? 1;
        const unit = item.precioUnitario ?? item.importeBase;
        if (qty > 1) detalle += ` — ${fmtNum(qty, 0)} x ${fmtNum(unit)}`;
        drawFila([
          fmtNum(qty, Number.isInteger(qty) ? 0 : 2),
          detalle,
          fmtNum(unit),
          fmtNum(item.ivaPct),
          fmtNum(item.importeBase),
        ]);
      }
    }

    // Comprobantes asociados (comprobante de anulación → CVLP original)
    if (opts.asociados?.length) {
      y += 8;
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor("#000")
        .text("Comprobantes asociados", M, y, { width: CW });
      y += 14;
      for (const asoc of opts.asociados) {
        const nro = `${String(asoc.ptoVenta).padStart(4, "0")}-${String(asoc.nro).padStart(8, "0")}`;
        const label = `Tipo ${String(asoc.tipo).padStart(3, "0")}  N° ${nro}`;
        doc
          .fontSize(7.5)
          .font("Helvetica")
          .fillColor("#333")
          .text(label, M + 4, y, { width: CW - 8 });
        y += 12;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    // Línea divisora
    doc
      .moveTo(M, footerY - 4)
      .lineTo(M + CW, footerY - 4)
      .stroke(col.linea("#aaa"));

    // Pie: totales del comprobante armado (incluye conceptos configurables).
    const pie = cvlpPdfPieFinanciero(liq, cvlp);
    const impTotal = pie.total;
    doc
      .fontSize(7)
      .font("Helvetica")
      .fillColor("#333")
      .text(`Son: ${numeroALetras(impTotal).toLowerCase()}`, M, footerY, {
        width: CW,
      });

    const footerBoxY = footerY + 12;
    const footerBoxH = 70;
    doc.rect(M, footerBoxY, CW, footerBoxH).stroke(col.linea("#aaa"));

    // QR
    if (qrBuffer) {
      doc.image(qrBuffer, M + 4, footerBoxY + 4, { width: 62, height: 62 });
    }

    // ARCA text
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("ARCA", M + 72, footerBoxY + 14, { width: 150 });
    doc
      .fontSize(6)
      .font("Helvetica")
      .fillColor("#555")
      .text("AGENCIA DE RECAUDACIÓN", M + 72, footerBoxY + 27, { width: 150 })
      .text("Y CONTROL ADUANERO", M + 72, footerBoxY + 34, { width: 150 });

    // Totales (derecha)
    const totX = M + CW - 200;
    const labelW = 120;
    const valW = 70;
    doc.fontSize(7.5).font("Helvetica").fillColor("#000");
    const totRows: [string, string][] = [
      ["Importe Neto Gravado: $", fmtNum(pie.netoGravado)],
      ["Importe Otros Tributos: $", fmtNum(pie.otrosTributos)],
      ["IVA: $", fmtNum(pie.iva)],
      ["Importe Total: $", fmtNum(impTotal)],
    ];

    let currentY = footerBoxY + 6;
    totRows.forEach(([label, val]) => {
      const labelHeight = doc.heightOfString(label, { width: labelW });
      const valHeight = doc.heightOfString(val, { width: valW });
      const rowHeight = Math.max(labelHeight, valHeight, 10);

      doc.text(label, totX, currentY, {
        width: labelW,
        align: "left",
        lineBreak: true,
      });
      doc
        .font("Helvetica-Bold")
        .text(val, totX + labelW, currentY, { width: valW, align: "right" });
      doc.font("Helvetica");

      currentY += rowHeight + 1.5;
    });

    currentY = Math.max(currentY, footerBoxY + 52);

    if (opts.cae) {
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor("#000")
        .text(`CAE N°: ${opts.cae}`, totX, currentY, { width: 190 })
        .text(`Vto CAE: ${fmtDate(opts.caeFechaVto)}`, totX, currentY + 10, {
          width: 190,
        });
    } else {
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor("#999")
        .text("Pendiente de emisión (sin CAE)", totX, currentY, { width: 190 });
    }

    // Al final de la página: encima del contenido, sin taparlo (opacity).
    if (showTestWatermark) {
      drawHomologacionWatermark(doc);
    }
  }
}
