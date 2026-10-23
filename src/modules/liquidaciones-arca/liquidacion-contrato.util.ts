import { round2 } from './arca-iva.util';
import { nombreConDetalle } from './cvlp-conceptos.util';
import { readStoredMicCrtExport } from '../viajes/mic-crt-export.util';

export type LiquidacionContratoViajeInput = {
  numero: string;
  numeroIdentificacionPersonalizado?: string | null;
  /** Label configurable del tenant para "ID Propio 2" y su valor en este viaje; ambos null si el tenant no lo habilitó o el viaje no tiene valor cargado. */
  idPropio2Label?: string | null;
  idPropio2Valor?: string | null;
  origen: string | null;
  destino: string | null;
  fechaCarga: Date | string | null;
  fechaDescarga: Date | string | null;
  choferNombre: string | null;
  mercaderia: string | null;
  crt: string | null;
  mic: string | null;
  remito: string | null;
  toneladas: number | null;
  precioPorTn: number | null;
  subtotal: number;
  adelanto: number;
  moneda: string;
};

export type LiquidacionContratoGrupo = {
  precioPorTn: number | null;
  viajes: LiquidacionContratoViajeInput[];
  toneladas: number;
  subtotal: number;
  adelanto?: number;
};

export type LiquidacionContratoConceptoLinea = {
  nombreSnapshot: string;
  signo: string;
  monto: number;
  cantidad?: number;
  montoUnitario?: number | null;
  modoAplicacion?: string;
};

export type LiquidacionContratoConcepto = {
  label: string;
  monto: number;
  signo: 'favor' | 'contra' | string;
};

export type LiquidacionContratoTotales = {
  grupos: LiquidacionContratoGrupo[];
  mismoPrecio: boolean;
  toneladas: number;
  bruto: number;
  subtotal: number;
  comision: number;
  comisionPct: number;
  conceptos: LiquidacionContratoConcepto[];
  conceptosLineas: LiquidacionContratoConceptoLinea[];
  netoGravado: number;
  ivaPct: number;
  iva: number;
  adelanto?: number;
  totalFlete: number;
  totalAPagar: number;
  moneda: string;
  cantViajes: number;
};

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function precioKey(precio: number | null): string {
  if (precio == null || !Number.isFinite(precio)) return 'na';
  return String(Math.round(precio * 10000) / 10000);
}

export function fmtContratoDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const iso = typeof d === 'string' ? d : d.toISOString();
  const [y, m, day] = iso.slice(0, 10).split('-');
  if (!y || !m || !day) return '—';
  return `${day}/${m}/${y}`;
}

export function mercaderiaDesdeProductos(
  productos: Array<{ producto?: { nombre?: string | null } | null; pesoKg?: number | null }> | null | undefined,
  detalleCarga?: string | null,
): string | null {
  const names = (productos ?? [])
    .map((p) => p.producto?.nombre?.trim())
    .filter((s): s is string => Boolean(s));
  if (names.length) return [...new Set(names)].join(', ');
  const det = detalleCarga?.trim();
  return det || null;
}

/**
 * Determina el título y subtítulo del contrato comercial para el PDF según
 * el proveedor / entidad configurada o el título por defecto.
 */
export function encabezadoContratoProveedor(proveedorContrato?: string | null): {
  titulo: string;
  subtitulo: string | null;
} {
  const p = proveedorContrato?.trim();
  if (p) {
    return {
      titulo: `CONTRATO PROVEEDOR POR ${p.toUpperCase()}`,
      subtitulo: null,
    };
  }
  return {
    titulo: 'LIQUIDACIÓN DE FLETE',
    subtitulo: 'Contrato / liquidación a proveedor',
  };
}

export function crtMicRemitoDesdeDocumento(documentoAduanero: unknown): {
  crt: string | null;
  mic: string | null;
  remito: string | null;
} {
  const stored = readStoredMicCrtExport(documentoAduanero);
  const raw =
    documentoAduanero && typeof documentoAduanero === 'object'
      ? (documentoAduanero as Record<string, unknown>)
      : {};
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  return {
    crt: stored?.crtNumero?.trim() || str(raw.crt) || str(raw.crtNumero),
    mic: stored?.micNumero?.trim() || str(raw.mic) || str(raw.micNumero),
    remito: str(raw.remito) || str(raw.remitoNumero) || str(raw.nroRemito),
  };
}

/**
 * Resuelve los identificadores documentales (CRT, MIC y Remito) para el contrato comercial PDF:
 * - MIC: Se mapea con prioridad desde ID Personalizado 1 (numeroIdentificacionPersonalizado). Fallback a nóminas si no está definido.
 * - Remito: Se mapea con prioridad desde ID Personalizado 2 (idPropio2). Fallback a nóminas si no está definido.
 * - CRT: Se extrae del documento aduanero / nómina (o null si no está cargado).
 */
export function resolverDocsViajeContrato(viaje?: {
  documentoAduanero?: unknown;
  numeroIdentificacionPersonalizado?: string | null;
  idPropio2?: string | null;
} | null): {
  crt: string | null;
  mic: string | null;
  remito: string | null;
} {
  const docs = crtMicRemitoDesdeDocumento(viaje?.documentoAduanero);
  const idPersonalizado1 =
    typeof viaje?.numeroIdentificacionPersonalizado === 'string' &&
    viaje.numeroIdentificacionPersonalizado.trim()
      ? viaje.numeroIdentificacionPersonalizado.trim()
      : null;
  const idPersonalizado2 =
    typeof viaje?.idPropio2 === 'string' && viaje.idPropio2.trim()
      ? viaje.idPropio2.trim()
      : null;

  return {
    crt: docs.crt,
    mic: idPersonalizado1 || docs.mic,
    remito: idPersonalizado2 || docs.remito,
  };
}

export function adelantoDesdePagos(pagos: unknown, moneda: string): number {
  if (!Array.isArray(pagos)) return 0;
  const mon = (moneda || 'ARS').toUpperCase();
  let sum = 0;
  for (const p of pagos) {
    if (!p || typeof p !== 'object') continue;
    const row = p as { monto?: unknown; moneda?: unknown };
    const rowMon = String(row.moneda ?? mon).toUpperCase();
    if (rowMon !== mon) continue;
    sum = round2(sum + n(Number(row.monto)));
  }
  return sum;
}

export function buildLiquidacionContratoTotales(args: {
  viajes: LiquidacionContratoViajeInput[];
  ivaPct?: number;
  comision?: number | null;
  comisionPct?: number | null;
  conceptosLineas?: Array<{
    nombreSnapshot?: string | null;
    nombre?: string | null;
    signo?: string | null;
    monto?: number | null;
    ivaPct?: number | null;
    cantidad?: number | null;
    montoUnitario?: number | null;
    modoAplicacion?: string | null;
    detalle?: string | null;
  }> | null;
  ivaPersistido?: number | null;
  liquidoPersistido?: number | null;
  moneda?: string | null;
  liq?: {
    bruto?: number | null;
    comision?: number | null;
    comisionPct?: number | null;
    ivaPct?: number | null;
    gastosAdminIva?: number | null;
    liquido?: number | null;
    moneda?: string | null;
    cantViajes?: number | null;
    conceptosLineas?: Array<{
      nombreSnapshot?: string | null;
      nombre?: string | null;
      signo?: string | null;
      monto?: number | null;
      ivaPct?: number | null;
      cantidad?: number | null;
      montoUnitario?: number | null;
      modoAplicacion?: string | null;
      detalle?: string | null;
    }> | null;
  } | null;
}): LiquidacionContratoTotales {
  const map = new Map<string, LiquidacionContratoGrupo>();
  for (const v of args.viajes) {
    const key = precioKey(v.precioPorTn);
    const g = map.get(key) ?? {
      precioPorTn: v.precioPorTn,
      viajes: [],
      toneladas: 0,
      subtotal: 0,
      adelanto: 0,
    };
    g.viajes.push(v);
    g.toneladas = round2(g.toneladas + n(v.toneladas));
    g.subtotal = round2(g.subtotal + n(v.subtotal));
    g.adelanto = round2(g.adelanto + n(v.adelanto));
    map.set(key, g);
  }
  const grupos = [...map.values()].sort((a, b) => {
    if (a.precioPorTn == null) return 1;
    if (b.precioPorTn == null) return -1;
    return a.precioPorTn - b.precioPorTn;
  });

  const toneladas = round2(grupos.reduce((s, g) => s + g.toneladas, 0));
  const adelanto = round2(grupos.reduce((s, g) => s + (g.adelanto ?? 0), 0));
  const subtotalViajes = round2(grupos.reduce((s, g) => s + g.subtotal, 0));

  const cantViajes = args.liq?.cantViajes ?? args.viajes.length;
  const rawBruto = args.liq?.bruto != null ? round2(args.liq.bruto) : subtotalViajes;
  const rawComision = args.liq?.comision !== undefined ? args.liq.comision : args.comision;
  const rawComisionPct = args.liq?.comisionPct !== undefined ? args.liq.comisionPct : args.comisionPct;
  const rawConceptosLineas = args.liq?.conceptosLineas ?? args.conceptosLineas;
  const rawIvaPct = args.liq?.ivaPct !== undefined ? args.liq.ivaPct : args.ivaPct;
  const ivaPersistido = args.liq?.gastosAdminIva !== undefined ? args.liq.gastosAdminIva : args.ivaPersistido;
  const liquidoPersistido = args.liq?.liquido !== undefined ? args.liq.liquido : args.liquidoPersistido;

  const comisionPct =
    typeof rawComisionPct === 'number' && Number.isFinite(rawComisionPct) && rawComisionPct > 0
      ? round2(rawComisionPct)
      : 0;

  let comision = 0;
  if (typeof rawComision === 'number' && Number.isFinite(rawComision) && rawComision > 0) {
    comision = round2(rawComision);
  } else if (comisionPct > 0) {
    comision = round2((rawBruto * comisionPct) / 100);
  }

  const conceptos: LiquidacionContratoConcepto[] = [];
  const conceptosLineasMapped: LiquidacionContratoConceptoLinea[] = [];
  let conceptosNetoSum = 0;
  for (const l of rawConceptosLineas ?? []) {
    const montoUnit = Math.abs(Number(l?.monto) || 0);
    if (!montoUnit) continue;
    const nombre = l.nombreSnapshot?.trim() || l.nombre?.trim() || 'Concepto';
    const signo = String(l.signo || '').toLowerCase() === 'favor' ? 'favor' : 'contra';
    const linePct = l.ivaPct != null && Number.isFinite(Number(l.ivaPct)) ? Number(l.ivaPct) : null;
    const esTodos = l.modoAplicacion === 'TODOS_LOS_VIAJES';
    const cantidad = esTodos ? Math.max(cantViajes, 1) : Number(l.cantidad) || 1;
    const montoTotal = esTodos ? round2(montoUnit * cantidad) : montoUnit;

    const detalle = [
      cantidad !== 1 && l.montoUnitario != null
        ? `${cantidad.toLocaleString('es-AR')} × ${l.montoUnitario}`
        : null,
      linePct != null ? `IVA ${linePct}%` : null,
    ].filter(Boolean);
    const label = `${nombreConDetalle(nombre, l.detalle)}${detalle.length ? ` (${detalle.join(', ')})` : ''}`;

    conceptos.push({ label, monto: montoTotal, signo });
    conceptosLineasMapped.push({
      nombreSnapshot: nombre,
      signo,
      monto: montoTotal,
      cantidad,
      montoUnitario: l.montoUnitario,
      modoAplicacion: l.modoAplicacion ?? undefined,
    });
    conceptosNetoSum = round2(conceptosNetoSum + (signo === 'favor' ? montoTotal : -montoTotal));
  }

  const subtotal = rawBruto;
  const netoGravado = round2(subtotal - comision + conceptosNetoSum);

  const ivaPct = Number.isFinite(rawIvaPct) ? Number(rawIvaPct) : 0;
  const iva =
    typeof ivaPersistido === 'number' && Number.isFinite(ivaPersistido)
      ? round2(ivaPersistido)
      : ivaPct > 0
        ? round2((netoGravado * ivaPct) / 100)
        : 0;

  const totalAPagar =
    typeof liquidoPersistido === 'number' && Number.isFinite(liquidoPersistido)
      ? round2(liquidoPersistido - adelanto)
      : round2(netoGravado + iva - adelanto);

  const totalFlete =
    typeof liquidoPersistido === 'number' && Number.isFinite(liquidoPersistido)
      ? round2(liquidoPersistido)
      : round2(subtotal + (ivaPct > 0 ? round2((subtotal * ivaPct) / 100) : 0) - adelanto);

  const moneda = args.liq?.moneda || args.moneda || args.viajes[0]?.moneda || 'ARS';

  return {
    grupos,
    mismoPrecio: grupos.length === 1,
    toneladas,
    bruto: rawBruto,
    subtotal,
    comision,
    comisionPct,
    conceptos,
    conceptosLineas: conceptosLineasMapped,
    netoGravado,
    ivaPct,
    iva,
    adelanto,
    totalFlete,
    totalAPagar,
    moneda,
    cantViajes,
  };
}
