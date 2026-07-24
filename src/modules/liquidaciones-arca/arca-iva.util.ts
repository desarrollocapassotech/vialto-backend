import type { AlicIva } from './types/arca.types';

/** AFIP alícuota 21 % (WSFEv1). */
export const IVA_21_ID = 5;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normaliza alícuota a 1 decimal (evita 10.5000001 / 21.0000002 por Float de DB). */
export function normalizeIvaPct(pct: number): number {
  return Math.round(pct * 10) / 10;
}

/**
 * AFIP AlicIva.Id según alícuota % (WSFEv1).
 * 3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5%.
 */
export function ivaIdFromPct(pct: number): number {
  const p = normalizeIvaPct(pct);
  if (p === 0) return 3;
  if (p === 2.5) return 9;
  if (p === 5) return 8;
  if (p === 10.5) return 4;
  if (p === 21) return IVA_21_ID;
  if (p === 27) return 6;
  return IVA_21_ID;
}

/** Alícuota % oficial de AFIP para un AlicIva.Id (WSFEv1). */
export function ivaPctFromId(id: number): number {
  switch (id) {
    case 3:
      return 0;
    case 9:
      return 2.5;
    case 8:
      return 5;
    case 4:
      return 10.5;
    case 5:
      return 21;
    case 6:
      return 27;
    default:
      return 21;
  }
}

/**
 * Totaliza AlicIva para WSFEv1.
 * - Un solo registro por Id (AFIP rechaza Ids repetidos).
 * - Importe = BaseImp × % oficial del Id (AFIP 10051 si no cuadra).
 * - BaseImp debe ser > 0 (AFIP 10020). Descuentos/comisión (bases negativas) se
 *   netean en la misma alícuota; si quedara un Id solo con base ≤ 0, se consolida
 *   todo el neto gravado en la alícuota principal.
 */
export function groupAlicuotasIva(
  items: Array<{ importeBase: number; ivaPct: number; importeIva?: number }>,
  opts?: { fallbackIvaPct?: number },
): AlicIva[] {
  const totalBase = round2(items.reduce((s, it) => s + it.importeBase, 0));
  // AFIP no acepta BaseImp ≤ 0. Neto ≤ 0 → sin AlicIva (anulación / vacío).
  if (totalBase <= 0) return [];

  const map = new Map<number, number>();
  for (const it of items) {
    const id = ivaIdFromPct(it.ivaPct);
    map.set(id, round2((map.get(id) ?? 0) + it.importeBase));
  }

  const positive = [...map.entries()]
    .filter(([, base]) => base > 0)
    .sort((a, b) => b[1] - a[1]);
  const positiveSum = round2(positive.reduce((s, [, b]) => s + b, 0));

  // Había bases negativas en otro Id (ej. descuento a distinta alícuota): consolidar.
  if (positive.length === 0 || positiveSum !== totalBase) {
    const primaryId =
      positive[0]?.[0] ??
      ivaIdFromPct(opts?.fallbackIvaPct ?? items[0]?.ivaPct ?? 21);
    return [
      {
        Id: primaryId,
        BaseImp: totalBase,
        Importe: round2((totalBase * ivaPctFromId(primaryId)) / 100),
      },
    ];
  }

  return positive.map(([Id, BaseImp]) => ({
    Id,
    BaseImp,
    Importe: round2((BaseImp * ivaPctFromId(Id)) / 100),
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
 * Pie financiero del PDF CVLP a partir de montos persistidos (los enviados/autorizados por ARCA).
 * Garantiza Neto Gravado + Otros Tributos + IVA = Importe Total.
 */
export function cvlpPdfPieFinanciero(liq: {
  bruto: number;
  comision: number;
  gastosAdmin?: number;
  gastosAdminIva: number;
  liquido: number;
}): {
  netoGravado: number;
  otrosTributos: number;
  iva: number;
  total: number;
  balances: boolean;
} {
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
