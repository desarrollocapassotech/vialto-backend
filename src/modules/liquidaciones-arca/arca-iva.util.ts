import type { AlicIva } from './types/arca.types';

/** AFIP alícuota 21 % (WSFEv1). */
export const IVA_21_ID = 5;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
