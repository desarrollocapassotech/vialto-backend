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
  const map = new Map<number, { base: number; iva: number }>();
  for (const it of items) {
    const cur = map.get(it.ivaPct) ?? { base: 0, iva: 0 };
    cur.base = round2(cur.base + it.importeBase);
    cur.iva = round2(cur.iva + it.importeIva);
    map.set(it.ivaPct, cur);
  }
  return [...map.entries()].map(([pct, v]) => ({
    Id: ivaIdFromPct(pct),
    BaseImp: v.base,
    Importe: v.iva,
  }));
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
