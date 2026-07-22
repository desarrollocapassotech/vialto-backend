import type { AlicIva } from './types/arca.types';

/** AFIP alícuota 21 % (WSFEv1). */
export const IVA_21_ID = 5;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  const impIva = round2(netoGravado * ivaPct / 100);
  const liquido = round2(netoGravado + impIva);
  return {
    netoGravado,
    impIva,
    liquido,
    impNeto: netoGravado,
    alicuota: {
      Id: IVA_21_ID,
      BaseImp: netoGravado,
      Importe: impIva,
    },
  };
}
