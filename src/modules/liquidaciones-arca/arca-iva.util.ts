import type { AlicIva } from './types/arca.types';

/** AFIP alícuota 0 % (WSFEv1 AlicIva.Id 3). */
export const IVA_0_ID = 3;
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
 * Tasas fuera de esta lista no tienen Id oficial (antes caían a 21% y
 * recalculaban mal el IVA de la liquidación).
 */
export const AFIP_IVA_PCTS = [0, 2.5, 5, 10.5, 21, 27] as const;

export function isAfipIvaPct(pct: number): boolean {
  const p = normalizeIvaPct(pct);
  return (AFIP_IVA_PCTS as readonly number[]).includes(p);
}

export function ivaIdFromPct(pct: number): number {
  const p = normalizeIvaPct(pct);
  if (p === 0) return IVA_0_ID;
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
    case IVA_0_ID:
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
 *   netean en la misma alícuota; si quedara un Id gravado solo con base ≤ 0, se
 *   consolida el neto gravado en la alícuota principal.
 * - Las bases a 0% (exento / no gravado) NUNCA se pliegan a 21%: no pueden ir
 *   en AlicIva si son ≤ 0 (10020) y no deben reducir ImpIVA. Gastos/seguro a 0%
 *   bajan el neto del pie, no el IVA de las líneas gravadas.
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

  const gravadoEntries = [...map.entries()].filter(([id]) => id !== IVA_0_ID);
  const exentoBase = round2(map.get(IVA_0_ID) ?? 0);
  const gravadoSum = round2(gravadoEntries.reduce((s, [, b]) => s + b, 0));

  const positiveGravado = gravadoEntries
    .filter(([, base]) => base > 0)
    .sort((a, b) => b[1] - a[1]);
  const positiveGravadoSum = round2(
    positiveGravado.reduce((s, [, b]) => s + b, 0),
  );

  let alic: AlicIva[] = [];

  if (gravadoSum > 0) {
    // Descuento gravado a otra alícuota (ej. 21% + 10.5% negativo): consolidar
    // solo lo gravado. El 0% no entra a esta cuenta.
    if (positiveGravado.length === 0 || positiveGravadoSum !== gravadoSum) {
      const primaryId =
        positiveGravado[0]?.[0] ??
        ivaIdFromPct(opts?.fallbackIvaPct ?? items[0]?.ivaPct ?? 21);
      alic = [
        {
          Id: primaryId,
          BaseImp: gravadoSum,
          Importe: round2((gravadoSum * ivaPctFromId(primaryId)) / 100),
        },
      ];
    } else {
      alic = positiveGravado.map(([Id, BaseImp]) => ({
        Id,
        BaseImp,
        Importe: round2((BaseImp * ivaPctFromId(Id)) / 100),
      }));
    }
  }

  // AlicIva 0% solo si la base neta es > 0 (AFIP 10020). Un descuento a 0% se
  // omite del array; no se absorbe en 21%.
  if (exentoBase > 0) {
    alic.push({ Id: IVA_0_ID, BaseImp: exentoBase, Importe: 0 });
  }

  return alic;
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
 * configurables. El fallback usa montos persistidos (autorizados por ARCA).
 * Garantiza Neto Gravado + Otros Tributos + IVA = Importe Total.
 * `gastosAdmin` está deprecado (siempre 0): no forma parte del CVLP.
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
  const netoGravado = round2(liq.bruto - liq.comision);
  const otrosTributos = 0;
  const iva = round2(liq.gastosAdminIva);
  const total = round2(liq.liquido);
  const balances = round2(netoGravado + otrosTributos + iva) === total;
  return { netoGravado, otrosTributos, iva, total, balances };
}

/**
 * Montos de liquidación / comprobante con IVA gravado al `ivaPct` indicado.
 * Garantiza BaseImp × tasa = Importe en AlicIva e ImpNeto + ImpIVA = ImpTotal.
 * El parámetro `gastosAdmin` está deprecado y se ignora (siempre se trata como 0).
 */
export function computeAfipGravadoIva(
  bruto: number,
  comision: number,
  _gastosAdmin: number,
  ivaPct: number,
): {
  netoGravado: number;
  impIva: number;
  liquido: number;
  impNeto: number;
  alicuota: AlicIva;
} {
  const netoGravado = round2(bruto - comision);
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
