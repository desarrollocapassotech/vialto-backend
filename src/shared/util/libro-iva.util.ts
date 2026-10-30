import { BadRequestException } from '@nestjs/common';

/**
 * Libro IVA (Ventas = facturas, Compras = liquidaciones): tipo común de comprobante, lectura
 * del pedido autorizado por AFIP en `ArcaLog` y armado de los TXT del Libro IVA Digital
 * (RG 4597, diseño de registros de ARCA: ventas 266/62, compras 325/84 caracteres).
 *
 * Reglas del diseño oficial que se aplican acá:
 * - Importes en positivo, 13 enteros + 2 decimales sin punto (una nota de crédito se informa
 *   con su tipo, no con signo). El signo negativo existe en el Excel para conciliar y, en el
 *   TXT, solo en la anulación de un CVLP con un 060 en negativo (`negativoEnTxt`).
 * - Numéricos con ceros a la izquierda, alfanuméricos con blancos a la derecha.
 * - Archivo ANSI (Windows-1252 / ISO 8859-1), mismo orden en cabecera y alícuotas.
 * - Compras B o C: 0 alícuotas y ningún registro de alícuotas.
 * - Compras 060 (CVLP): CUIT/denominación del emisor (el informante) e IVA de la comisión.
 */

export type LibroIvaTipo = 'ventas' | 'compras';

export interface LibroIvaAlicuota {
  /** Alícuota en % (0, 2.5, 5, 10.5, 21, 27). */
  pct: number;
  neto: number;
  iva: number;
}

export interface LibroIvaComprobante {
  /** factura | liquidacion: de qué registro sale (para abrirlo desde el front). */
  origenTipo: 'factura' | 'liquidacion';
  origenId: string;
  /** YYYY-MM-DD. */
  fecha: string;
  /** Tipo AFIP (1=Factura A, 3=NC A, 60=CVLP A…). Null si no se pudo determinar. */
  cbteTipo: number | null;
  ptoVenta: number | null;
  cbteNro: number | null;
  /** Número como se ve en el sistema ("A 0001-00000123", "0003-00000070"). */
  numeroTexto: string;
  /** 80=CUIT, 86=CUIL, 96=DNI, 99=sin identificar. */
  docTipo: number;
  docNro: string;
  contraparte: string;
  alicuotas: LibroIvaAlicuota[];
  noGravado: number;
  exento: number;
  otrosTributos: number;
  total: number;
  /** Código AFIP: PES | DOL. */
  moneda: string;
  cotizacion: number | null;
  cae: string | null;
  /** arca = emitido con CAE (montos de lo autorizado por AFIP); manual = cargado a mano. */
  origen: 'arca' | 'manual';
  /** Nota de crédito/débito que anula otro comprobante: en el Excel va en negativo. */
  anulacion: boolean;
  /**
   * Anulación con el mismo tipo que el original y los importes en negativo (CVLP 060 anulado
   * con un pre-impreso, criterio de ARCA para NyM): en el TXT también va con signo.
   */
  negativoEnTxt?: boolean;
  /** Emitido en homologación (sin validez fiscal): solo con la config ARCA en homologación. */
  prueba: boolean;
  /** Solo compras (CVLP 060): comisión e IVA de la comisión. */
  comision: number | null;
  ivaComision: number | null;
  /** Avisos para la contadora (montos recalculados, fecha estimada…). */
  observaciones: string[];
  /** Si tiene valor, el comprobante no puede ir al TXT (motivo). Sí sale en el Excel. */
  incompleto: string | null;
}

export interface LibroIvaResultado {
  tipo: LibroIvaTipo;
  desde: string;
  hasta: string;
  /** Libro de prueba: la config ARCA está en homologación y solo trae comprobantes de prueba. */
  esPrueba: boolean;
  informante: { cuit: string | null; razonSocial: string | null };
  comprobantes: LibroIvaComprobante[];
}

export interface LibroIvaTxt {
  archivos: Array<{ nombre: string; contenidoBase64: string }>;
  excluidos: Array<{ comprobante: string; motivo: string }>;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const MAX_DIAS_RANGO = 400;

export const AVISO_PRUEBA = 'Comprobante de prueba (homologación): no tiene validez fiscal.';

/** Valida `desde`/`hasta` (YYYY-MM-DD, desde ≤ hasta, hasta ~13 meses). */
export function validarRangoLibroIva(
  desde: string | undefined,
  hasta: string | undefined,
): { desde: string; hasta: string } {
  const ok = (s: string | undefined): s is string =>
    !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ok(desde) || !ok(hasta)) {
    throw new BadRequestException('Indicá el rango de fechas (desde y hasta).');
  }
  if (hasta < desde) {
    throw new BadRequestException('La fecha hasta no puede ser anterior a la fecha desde.');
  }
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
  if (dias > MAX_DIAS_RANGO) {
    throw new BadRequestException('El rango no puede superar los 13 meses.');
  }
  return { desde, hasta };
}

/** Medianoche UTC de `ymd` corrida `dias` días (para traer candidatos con margen). */
export function fechaConMargen(ymd: string, dias: number): Date {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + dias * 86_400_000);
}

export function ymdDeFecha(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function enRango(ymd: string, desde: string, hasta: string): boolean {
  return ymd >= desde && ymd <= hasta;
}

/** "0003-00000070" (punto de venta de 4 dígitos o más, número de 8). */
export function numeroAfipTexto(ptoVenta: number | null, cbteNro: number | null): string {
  if (cbteNro == null) return '';
  const nro = String(cbteNro).padStart(8, '0');
  return ptoVenta != null ? `${String(ptoVenta).padStart(4, '0')}-${nro}` : nro;
}

// ── Tipos de comprobante ────────────────────────────────────────────────────

const LABEL_CBTE: Record<number, string> = {
  1: 'Factura A',
  2: 'Nota de Débito A',
  3: 'Nota de Crédito A',
  6: 'Factura B',
  7: 'Nota de Débito B',
  8: 'Nota de Crédito B',
  11: 'Factura C',
  12: 'Nota de Débito C',
  13: 'Nota de Crédito C',
  19: 'Factura E',
  20: 'Nota de Débito E',
  21: 'Nota de Crédito E',
  51: 'Factura M',
  52: 'Nota de Débito M',
  53: 'Nota de Crédito M',
  60: 'Cta. de Vta. y Líquido Producto A',
  61: 'Cta. de Vta. y Líquido Producto B',
  201: 'Factura de Crédito Electrónica A',
  206: 'Factura de Crédito Electrónica B',
  211: 'Factura de Crédito Electrónica C',
};

export function labelTipoComprobante(cbteTipo: number | null): string {
  if (cbteTipo == null) return '—';
  return LABEL_CBTE[cbteTipo] ?? `Tipo ${cbteTipo}`;
}

const CLASE_B = new Set([6, 7, 8, 9, 10, 40, 61, 64, 206, 207, 208]);
const CLASE_C = new Set([11, 12, 13, 15, 211, 212, 213]);

/** Comprobante que no discrimina IVA (B o C). */
export function esClaseBoC(cbteTipo: number | null): boolean {
  return cbteTipo != null && (CLASE_B.has(cbteTipo) || CLASE_C.has(cbteTipo));
}

export function esClaseC(cbteTipo: number | null): boolean {
  return cbteTipo != null && CLASE_C.has(cbteTipo);
}

// ── Alícuotas AFIP (Id ↔ %) — mismos códigos en WSFEv1 y en el Libro IVA Digital ──

const ALICUOTA_ID_A_PCT: Record<number, number> = { 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 };

export function alicuotaPctDesdeId(id: number): number | null {
  return ALICUOTA_ID_A_PCT[id] ?? null;
}

export function alicuotaIdDesdePct(pct: number): number | null {
  const p = Math.round(pct * 10) / 10;
  const hit = Object.entries(ALICUOTA_ID_A_PCT).find(([, v]) => v === p);
  return hit ? Number(hit[0]) : null;
}

/** Agrupa bases por alícuota (una fila por %), IVA redondeado por alícuota. */
export function agruparAlicuotas(
  items: Array<{ base: number; pct: number; iva?: number }>,
): LibroIvaAlicuota[] {
  const map = new Map<number, { neto: number; iva: number }>();
  for (const it of items) {
    const pct = Math.round(it.pct * 10) / 10;
    const prev = map.get(pct) ?? { neto: 0, iva: 0 };
    prev.neto = round2(prev.neto + it.base);
    prev.iva = round2(prev.iva + (it.iva ?? round2((it.base * pct) / 100)));
    map.set(pct, prev);
  }
  return [...map.entries()]
    .filter(([, v]) => v.neto !== 0 || v.iva !== 0)
    .sort((a, b) => b[0] - a[0])
    .map(([pct, v]) => ({ pct, neto: v.neto, iva: v.iva }));
}

// ── Documento de la contraparte ─────────────────────────────────────────────

/** CUIT (11 dígitos) → 80; DNI (7-8) → 96; si no, 99 "sin identificar". */
export function documentoDesdeIdFiscal(idFiscal: string | null | undefined): {
  docTipo: number;
  docNro: string;
} {
  const digitos = (idFiscal ?? '').replace(/\D/g, '');
  if (digitos.length === 11) return { docTipo: 80, docNro: digitos };
  if (digitos.length === 7 || digitos.length === 8) return { docTipo: 96, docNro: digitos };
  return { docTipo: 99, docNro: '0' };
}

export function monedaAfip(moneda: string | null | undefined): string {
  const m = (moneda ?? 'ARS').toUpperCase();
  if (m === 'ARS' || m === 'PES') return 'PES';
  if (m === 'USD' || m === 'DOL') return 'DOL';
  return m;
}

// ── Pedido autorizado por AFIP (ArcaLog) ────────────────────────────────────

export interface ComprobanteAutorizado {
  cbteTipo: number;
  ptoVenta: number;
  cbteNro: number | null;
  /** YYYY-MM-DD. */
  fecha: string | null;
  docTipo: number;
  docNro: string;
  impTotal: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
  alicuotas: LibroIvaAlicuota[];
}

type Json = Record<string, unknown> | undefined | null;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const primero = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function fechaYmdDesdeCbteFch(v: unknown): string | null {
  const s = String(v ?? '').replace(/-/g, '');
  return /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** CAE que devolvió AFIP en la respuesta del log (null si fue rechazado). */
export function caeDeRespuestaArca(responseBody: unknown): string | null {
  const r = obj(responseBody);
  if (!r) return null;
  if (r.CAE) return String(r.CAE); // createNextVoucher
  const sol = obj(r.FECAESolicitarResult) ?? r;
  const det = obj(primero(obj(sol.FeDetResp)?.FECAEDetResponse));
  return det?.CAE ? String(det.CAE) : null;
}

/** Lee el comprobante del pedido del log (FECAESolicitar o createNextVoucher). */
export function comprobanteDeRequestArca(
  requestBody: unknown,
  responseBody?: unknown,
): ComprobanteAutorizado | null {
  const req = obj(requestBody);
  if (!req) return null;
  const params = obj(req.params);
  const feCaeReq = obj(params?.FeCAEReq);
  let det: Json = obj(primero(obj(feCaeReq?.FeDetReq)?.FECAEDetRequest));
  let cab: Json = obj(feCaeReq?.FeCabReq);
  let alicuotasRaw: unknown = obj(det?.Iva)?.AlicIva;
  let cbteNro: number | null = det?.CbteDesde != null ? num(det.CbteDesde) : null;
  if (!det) {
    det = obj(req.createNextVoucher);
    cab = det;
    alicuotasRaw = det?.Iva;
    const resp = obj(responseBody);
    cbteNro = resp?.voucherNumber != null ? num(resp.voucherNumber) : null;
  }
  if (!det || !cab) return null;
  const alicArr = Array.isArray(alicuotasRaw) ? alicuotasRaw : alicuotasRaw ? [alicuotasRaw] : [];
  const alicuotas = alicArr
    .map((a) => obj(a))
    .filter((a): a is Record<string, unknown> => !!a)
    .map((a) => ({
      pct: alicuotaPctDesdeId(num(a.Id)) ?? 0,
      neto: round2(num(a.BaseImp)),
      iva: round2(num(a.Importe)),
    }));
  return {
    cbteTipo: num(cab.CbteTipo),
    ptoVenta: num(cab.PtoVta),
    cbteNro,
    fecha: fechaYmdDesdeCbteFch(det.CbteFch),
    docTipo: num(det.DocTipo),
    docNro: String(det.DocNro ?? '0'),
    impTotal: round2(num(det.ImpTotal)),
    impTotConc: round2(num(det.ImpTotConc)),
    impOpEx: round2(num(det.ImpOpEx)),
    impTrib: round2(num(det.ImpTrib)),
    monId: String(det.MonId ?? 'PES'),
    monCotiz: num(det.MonCotiz) || 1,
    alicuotas,
  };
}

/** Log del FECAESolicitar cuyo CAE coincide con el del comprobante (el aprobado por AFIP). */
export function logAutorizadoPorCae<T extends { responseBody: unknown }>(
  logs: T[],
  cae: string | null | undefined,
): T | null {
  if (!cae) return null;
  return logs.find((l) => caeDeRespuestaArca(l.responseBody) === cae) ?? null;
}

export function comprobanteDeLog(
  log: { requestBody: unknown; responseBody: unknown } | null,
): ComprobanteAutorizado | null {
  return log ? comprobanteDeRequestArca(log.requestBody, log.responseBody) : null;
}

export type DatosComprobanteLibro = Pick<
  LibroIvaComprobante,
  | 'fecha'
  | 'cbteTipo'
  | 'ptoVenta'
  | 'cbteNro'
  | 'numeroTexto'
  | 'docTipo'
  | 'docNro'
  | 'alicuotas'
  | 'noGravado'
  | 'exento'
  | 'otrosTributos'
  | 'total'
  | 'moneda'
  | 'cotizacion'
  | 'observaciones'
>;

/**
 * Datos de un comprobante emitido en ARCA: lo que AFIP autorizó (log) o, si no se encontró el
 * log, lo guardado en el registro, con un aviso para que la contadora lo verifique.
 */
export function datosComprobanteArca(
  a: ComprobanteAutorizado | null,
  respaldo: {
    cbteTipo: number | null;
    ptoVenta: number | null;
    cbteNro: number | null;
    fecha: string;
    doc: { docTipo: number; docNro: string };
    montos: { alicuotas: LibroIvaAlicuota[]; total: number };
    moneda: string;
  },
): DatosComprobanteLibro {
  if (a) {
    const cbteNro = a.cbteNro ?? respaldo.cbteNro;
    return {
      fecha: a.fecha ?? respaldo.fecha,
      cbteTipo: a.cbteTipo,
      ptoVenta: a.ptoVenta,
      cbteNro,
      numeroTexto: numeroAfipTexto(a.ptoVenta, cbteNro),
      docTipo: a.docTipo,
      docNro: a.docNro,
      alicuotas: a.alicuotas,
      noGravado: a.impTotConc,
      exento: a.impOpEx,
      otrosTributos: a.impTrib,
      total: a.impTotal,
      moneda: a.monId,
      cotizacion: a.monCotiz,
      observaciones: [],
    };
  }
  return {
    fecha: respaldo.fecha,
    cbteTipo: respaldo.cbteTipo,
    ptoVenta: respaldo.ptoVenta,
    cbteNro: respaldo.cbteNro,
    numeroTexto: numeroAfipTexto(respaldo.ptoVenta, respaldo.cbteNro),
    docTipo: respaldo.doc.docTipo,
    docNro: respaldo.doc.docNro,
    alicuotas: respaldo.montos.alicuotas,
    noGravado: 0,
    exento: 0,
    otrosTributos: 0,
    total: respaldo.montos.total,
    moneda: respaldo.moneda,
    cotizacion: respaldo.moneda === 'PES' ? 1 : null,
    observaciones: [
      'No se encontró el registro de lo autorizado por AFIP: montos recalculados desde el sistema. Verificar contra el comprobante.',
    ],
  };
}

// ── TXT del Libro IVA Digital ───────────────────────────────────────────────

/** Texto apto para ANSI: sin caracteres fuera de Latin-1. */
function textoLatin1(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

function campoNum(n: number | string, largo: number): string {
  const s = String(n).replace(/\D/g, '');
  return s.padStart(largo, '0').slice(-largo);
}

function campoTexto(s: string, largo: number): string {
  return textoLatin1(s).slice(0, largo).padEnd(largo, ' ');
}

/** 13 enteros + 2 decimales sin punto; negativo con "-" en la primera posición. */
export function campoImporte(n: number): string {
  const centavos = Math.round(Math.abs(n) * 100);
  return n < 0 ? `-${String(centavos).padStart(14, '0')}` : String(centavos).padStart(15, '0');
}

/** 4 enteros + 6 decimales sin punto (obligatorio también en pesos: 0001000000). */
export function campoTipoCambio(c: number): string {
  return String(Math.round(c * 1_000_000)).padStart(10, '0').slice(-10);
}

function campoFecha(ymd: string): string {
  return ymd.replace(/-/g, '').slice(0, 8);
}

/** Código de operación: con todas las alícuotas en 0 → E (exento) o N (no gravado); si no, "0". */
function codigoOperacion(c: LibroIvaComprobante, alicuotas: LibroIvaAlicuota[]): string {
  if (alicuotas.length === 0) return '0';
  const todasCero = alicuotas.every((a) => a.pct === 0);
  if (!todasCero) return '0';
  return c.exento > 0 ? 'E' : 'N';
}

function motivoNoTxt(c: LibroIvaComprobante): string | null {
  if (c.incompleto) return c.incompleto;
  if (c.cbteTipo == null || c.ptoVenta == null || c.cbteNro == null) {
    return 'Falta tipo, punto de venta o número del comprobante.';
  }
  if (c.moneda !== 'PES' && !c.cotizacion) return 'Moneda extranjera sin tipo de cambio.';
  if (c.alicuotas.some((a) => alicuotaIdDesdePct(a.pct) == null)) {
    return 'Alícuota de IVA sin código de AFIP.';
  }
  return null;
}

/** Alícuotas a informar: ventas siempre al menos una (0% con neto 0 si no hay). */
function alicuotasTxt(tipo: LibroIvaTipo, c: LibroIvaComprobante): LibroIvaAlicuota[] {
  if (tipo === 'compras' && esClaseBoC(c.cbteTipo)) return [];
  if (c.alicuotas.length > 0) return c.alicuotas;
  return tipo === 'ventas' ? [{ pct: 0, neto: 0, iva: 0 }] : [];
}

export function lineaVentasCbte(c: LibroIvaComprobante): string {
  const alic = alicuotasTxt('ventas', c);
  return [
    campoFecha(c.fecha),
    campoNum(c.cbteTipo ?? 0, 3),
    campoNum(c.ptoVenta ?? 0, 5),
    campoNum(c.cbteNro ?? 0, 20),
    campoNum(c.cbteNro ?? 0, 20),
    campoNum(c.docTipo, 2),
    campoNum(c.docNro, 20),
    campoTexto(c.contraparte, 30),
    campoImporte(c.total),
    campoImporte(c.noGravado),
    campoImporte(0), // percepción a no categorizados
    campoImporte(c.exento),
    campoImporte(0), // percepciones nacionales
    campoImporte(0), // percepciones IIBB
    campoImporte(0), // percepciones municipales
    campoImporte(0), // impuestos internos
    campoTexto(c.moneda, 3),
    campoTipoCambio(c.cotizacion ?? 1),
    campoNum(alic.length, 1),
    codigoOperacion(c, alic),
    campoImporte(c.otrosTributos),
    campoNum(0, 8), // fecha de vencimiento o pago (solo servicios públicos)
  ].join('');
}

export function lineasVentasAlicuotas(c: LibroIvaComprobante): string[] {
  return alicuotasTxt('ventas', c).map((a) =>
    [
      campoNum(c.cbteTipo ?? 0, 3),
      campoNum(c.ptoVenta ?? 0, 5),
      campoNum(c.cbteNro ?? 0, 20),
      campoImporte(a.neto),
      campoNum(alicuotaIdDesdePct(a.pct) ?? 0, 4),
      campoImporte(a.iva),
    ].join(''),
  );
}

export function lineaComprasCbte(
  c: LibroIvaComprobante,
  informante: { cuit: string | null; razonSocial: string | null },
): string {
  const alic = alicuotasTxt('compras', c);
  const ivaTotal = round2(alic.reduce((s, a) => s + a.iva, 0));
  // CUIT emisor/corredor solo para 033/058/059/060/063: sin intermediario, el informante.
  const conCorredor = c.cbteTipo != null && [33, 58, 59, 60, 63].includes(c.cbteTipo);
  return [
    campoFecha(c.fecha),
    campoNum(c.cbteTipo ?? 0, 3),
    campoNum(c.ptoVenta ?? 0, 5),
    campoNum(c.cbteNro ?? 0, 20),
    campoNum(0, 16), // despacho de importación
    campoNum(c.docTipo, 2),
    campoNum(c.docNro, 20),
    campoTexto(c.contraparte, 30),
    campoImporte(c.total),
    campoImporte(c.noGravado),
    campoImporte(c.exento),
    campoImporte(0), // percepciones IVA
    campoImporte(0), // percepciones otros nacionales
    campoImporte(0), // percepciones IIBB
    campoImporte(0), // percepciones municipales
    campoImporte(0), // impuestos internos
    campoTexto(c.moneda, 3),
    campoTipoCambio(c.cotizacion ?? 1),
    campoNum(alic.length, 1),
    codigoOperacion(c, alic),
    campoImporte(ivaTotal), // crédito fiscal computable (sin prorrateo = impuesto liquidado)
    campoImporte(c.otrosTributos),
    campoNum(conCorredor ? (informante.cuit ?? '') : 0, 11),
    campoTexto(conCorredor ? (informante.razonSocial ?? '') : '', 30),
    campoImporte(conCorredor ? (c.ivaComision ?? 0) : 0),
  ].join('');
}

export function lineasComprasAlicuotas(c: LibroIvaComprobante): string[] {
  return alicuotasTxt('compras', c).map((a) =>
    [
      campoNum(c.cbteTipo ?? 0, 3),
      campoNum(c.ptoVenta ?? 0, 5),
      campoNum(c.cbteNro ?? 0, 20),
      campoNum(c.docTipo, 2),
      campoNum(c.docNro, 20),
      campoImporte(a.neto),
      campoNum(alicuotaIdDesdePct(a.pct) ?? 0, 4),
      campoImporte(a.iva),
    ].join(''),
  );
}

/** Mismo comprobante con todos los importes en negativo (para `negativoEnTxt`). */
function conImportesNegativos(c: LibroIvaComprobante): LibroIvaComprobante {
  const neg = (n: number) => -Math.abs(n);
  return {
    ...c,
    alicuotas: c.alicuotas.map((a) => ({ ...a, neto: neg(a.neto), iva: neg(a.iva) })),
    noGravado: neg(c.noGravado),
    exento: neg(c.exento),
    otrosTributos: neg(c.otrosTributos),
    total: neg(c.total),
    comision: c.comision != null ? neg(c.comision) : null,
    ivaComision: c.ivaComision != null ? neg(c.ivaComision) : null,
  };
}

function describir(c: LibroIvaComprobante): string {
  return `${labelTipoComprobante(c.cbteTipo)} ${c.numeroTexto || '(sin número)'} — ${c.contraparte}`;
}

/** Arma los dos archivos (cabecera + alícuotas) y lista lo que no pudo entrar. */
export function generarTxtLibroIva(resultado: LibroIvaResultado): LibroIvaTxt {
  const cbte: string[] = [];
  const alic: string[] = [];
  const excluidos: LibroIvaTxt['excluidos'] = [];
  for (const original of resultado.comprobantes) {
    const c = original.negativoEnTxt ? conImportesNegativos(original) : original;
    const motivo = motivoNoTxt(c);
    if (motivo) {
      excluidos.push({ comprobante: describir(c), motivo });
      continue;
    }
    if (resultado.tipo === 'ventas') {
      cbte.push(lineaVentasCbte(c));
      alic.push(...lineasVentasAlicuotas(c));
    } else {
      cbte.push(lineaComprasCbte(c, resultado.informante));
      alic.push(...lineasComprasAlicuotas(c));
    }
  }
  const sufijo = `${resultado.desde.replace(/-/g, '')}_${resultado.hasta.replace(/-/g, '')}${
    resultado.esPrueba ? '_PRUEBA' : ''
  }`;
  const base = resultado.tipo === 'ventas' ? 'LIBRO_IVA_DIGITAL_VENTAS' : 'LIBRO_IVA_DIGITAL_COMPRAS';
  const archivo = (lineas: string[]) =>
    Buffer.from(lineas.length ? `${lineas.join('\r\n')}\r\n` : '', 'latin1').toString('base64');
  return {
    archivos: [
      { nombre: `${base}_CBTE_${sufijo}.txt`, contenidoBase64: archivo(cbte) },
      { nombre: `${base}_ALICUOTAS_${sufijo}.txt`, contenidoBase64: archivo(alic) },
    ],
    excluidos,
  };
}
