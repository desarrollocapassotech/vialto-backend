import { round2 } from './arca-iva.util';
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

export type LiquidacionContratoTotales = {
  grupos: LiquidacionContratoGrupo[];
  mismoPrecio: boolean;
  toneladas: number;
  bruto: number;
  comision: number;
  comisionPct: number;
  conceptosLineas: LiquidacionContratoConceptoLinea[];
  subtotal: number;
  ivaPct: number;
  iva: number;
  adelanto?: number;
  totalFlete: number;
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
      nombreSnapshot: string;
      signo: string;
      monto: number;
      cantidad?: number;
      montoUnitario?: number | null;
      modoAplicacion?: string;
    }> | null;
  };
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

  if (args.liq) {
    const cantViajes = args.liq.cantViajes ?? args.viajes.length;
    const bruto =
      args.liq.bruto != null ? round2(args.liq.bruto) : subtotalViajes;
    const comision =
      args.liq.comision != null ? round2(args.liq.comision) : 0;
    const comisionPct =
      args.liq.comisionPct != null ? Number(args.liq.comisionPct) : 0;
    const ivaPct =
      args.liq.ivaPct != null && Number.isFinite(args.liq.ivaPct)
        ? Number(args.liq.ivaPct)
        : Number.isFinite(args.ivaPct ?? 0)
          ? Number(args.ivaPct ?? 0)
          : 0;

    const conceptosLineas: LiquidacionContratoConceptoLinea[] = (
      args.liq.conceptosLineas ?? []
    ).map((c) => ({
      nombreSnapshot: c.nombreSnapshot,
      signo: c.signo,
      monto: round2(n(c.monto)),
      cantidad: c.cantidad,
      montoUnitario: c.montoUnitario,
      modoAplicacion: c.modoAplicacion,
    }));

    const conceptosNetoSum = round2(
      conceptosLineas.reduce((acc, c) => {
        const factor =
          c.modoAplicacion === 'TODOS_LOS_VIAJES'
            ? Math.max(cantViajes, 1)
            : 1;
        const importe = round2(c.monto * factor);
        return acc + (c.signo === 'favor' ? importe : -importe);
      }, 0),
    );

    const iva =
      args.liq.gastosAdminIva != null
        ? round2(args.liq.gastosAdminIva)
        : ivaPct > 0
          ? round2(((bruto - comision + conceptosNetoSum) * ivaPct) / 100)
          : 0;

    const totalFlete =
      args.liq.liquido != null
        ? round2(args.liq.liquido)
        : round2(bruto - comision + conceptosNetoSum + iva);

    // Subtotal (Neto gravado): derivado de totalFlete - iva para garantizar consistencia matemática exacta
    const subtotal =
      args.liq.liquido != null && args.liq.gastosAdminIva != null
        ? round2(totalFlete - iva)
        : round2(bruto - comision + conceptosNetoSum);

    const moneda = args.liq.moneda || args.viajes[0]?.moneda || 'ARS';

    return {
      grupos,
      mismoPrecio: grupos.length === 1,
      toneladas,
      bruto,
      comision,
      comisionPct,
      conceptosLineas,
      subtotal,
      ivaPct,
      iva,
      adelanto,
      totalFlete,
      moneda,
      cantViajes,
    };
  }

  // Fallback si no se envía `liq`
  const ivaPct = Number.isFinite(args.ivaPct) ? (args.ivaPct as number) : 0;
  const iva = ivaPct > 0 ? round2((subtotalViajes * ivaPct) / 100) : 0;
  const moneda = args.viajes[0]?.moneda ?? 'ARS';

  return {
    grupos,
    mismoPrecio: grupos.length === 1,
    toneladas,
    bruto: subtotalViajes,
    comision: 0,
    comisionPct: 0,
    conceptosLineas: [],
    subtotal: subtotalViajes,
    ivaPct,
    iva,
    adelanto,
    totalFlete: round2(subtotalViajes + iva - adelanto),
    moneda,
    cantViajes: args.viajes.length,
  };
}
