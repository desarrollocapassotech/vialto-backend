import type { AlicIva } from './types/arca.types';

/** AFIP alícuota 21 % (WSFEv1). */
export const IVA_21_ID = 5;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** AFIP AlicIva.Id según alícuota %. */
export function ivaIdFromPct(pct: number): number {
  if (pct === 0) return 3;
  if (pct === 10.5) return 4;
  if (pct === 27) return 6;
  return IVA_21_ID;
}

export function groupAlicuotasIva(
  items: Array<{ importeBase: number; ivaPct: number; importeIva: number }>,
): AlicIva[] {
  // AFIP exige un único AlicIva por Id; agrupar por Id (no por %).
  const map = new Map<number, { base: number; iva: number }>();
  for (const it of items) {
    const id = ivaIdFromPct(it.ivaPct);
    const cur = map.get(id) ?? { base: 0, iva: 0 };
    cur.base = round2(cur.base + it.importeBase);
    cur.iva = round2(cur.iva + it.importeIva);
    map.set(id, cur);
  }
  return [...map.entries()].map(([id, v]) => ({
    Id: id,
    BaseImp: v.base,
    Importe: v.iva,
  }));
}

/** Alícuota del emisor (`ArcaConfig.ivaGastosAdmin`); default 21 si no hay config. */
export function resolveIvaPct(configIvaPct: number | null | undefined): number {
  return typeof configIvaPct === 'number' && Number.isFinite(configIvaPct)
    ? configIvaPct
    : 21;
}

/** SubTotal c/IVA de una línea (neto con signo × (1 + alícuota/100)). */
export function subtotalConIva(netoSinIva: number, ivaPct: number): number {
  return round2(netoSinIva * (1 + ivaPct / 100));
}

/** Texto de alícuota para la columna del PDF (ej. "10,50"). */
export function formatAlicuotaIva(ivaPct: number): string {
  return ivaPct.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Pie financiero del PDF CVLP.
 * Preferir montos del comprobante armado (`cvlp`) cuando existen: incluyen conceptos
 * configurables. El fallback desde `liq` solo aplica bruto−comisión−gastosAdmin.
 */
export function cvlpPdfPieFinanciero(
  liq: {
    bruto: number;
    comision: number;
    gastosAdmin?: number;
    gastosAdminIva: number;
    liquido: number;
  },
  cvlp?: { impNeto: number; impIva: number; impTotal: number } | null,
): {
  netoGravado: number;
  otrosTributos: number;
  iva: number;
  total: number;
  balances: boolean;
} {
  if (cvlp) {
    const netoGravado = round2(cvlp.impNeto);
    const otrosTributos = 0;
    const iva = round2(cvlp.impIva);
    const total = round2(cvlp.impTotal);
    return {
      netoGravado,
      otrosTributos,
      iva,
      total,
      balances: round2(netoGravado + otrosTributos + iva) === total,
    };
  }
  const gastosAdmin = liq.gastosAdmin ?? 0;
  const netoGravado = round2(liq.bruto - liq.comision - gastosAdmin);
  const otrosTributos = 0;
  const iva = round2(liq.gastosAdminIva);
  const total = round2(liq.liquido);
  const balances = round2(netoGravado + otrosTributos + iva) === total;
  return { netoGravado, otrosTributos, iva, total, balances };
}

/**
 * Montos de liquidación / comprobante con IVA gravado al `ivaPct` indicado.
 * Garantiza BaseImp × tasa = Importe en AlicIva e ImpNeto + ImpIVA = ImpTotal.
 */
export function computeAfipGravadoIva(
  bruto: number,
  comision: number,
  gastosAdmin: number,
  ivaPct: number,
): {
  netoGravado: number;
  impIva: number;
  liquido: number;
  impNeto: number;
  alicuota: AlicIva;
} {
  const netoGravado = round2(bruto - comision - gastosAdmin);
  const impIva = round2((netoGravado * ivaPct) / 100);
  const liquido = round2(netoGravado + impIva);
  return {
    netoGravado,
    impIva,
    liquido,
    impNeto: netoGravado,
    alicuota: {
      Id: ivaIdFromPct(ivaPct),
      BaseImp: netoGravado,
      Importe: impIva,
    },
  };
}
