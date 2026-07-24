import { groupAlicuotasIva, round2 } from './arca-iva.util';
import type { ConceptoFacturable } from './arca-cvlp.util';

export type ConceptoSigno = 'favor' | 'contra';

export type ConceptoLineaInput = {
  nombreSnapshot: string;
  signo: ConceptoSigno;
  ivaPct: number;
  monto: number;
  orden?: number;
};

export function signedImporte(signo: ConceptoSigno, monto: number): number {
  const abs = Math.abs(monto);
  return signo === 'favor' ? abs : -abs;
}

/**
 * Conceptos base (Fletes / Comisión / Gastos admin) + líneas configurables del tenant.
 */
export function buildCvlpConceptosList(args: {
  bruto: number;
  comision: number;
  gastosAdmin: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
}): ConceptoFacturable[] {
  const conceptos: ConceptoFacturable[] = [
    { descripcion: 'Fletes', importe: args.bruto, ivaPct: args.ivaPctDefault },
    { descripcion: 'Comisión', importe: -args.comision, ivaPct: args.ivaPctDefault },
  ];
  if (args.gastosAdmin !== 0) {
    conceptos.push({
      descripcion: 'Gastos Administrativos',
      importe: -args.gastosAdmin,
      ivaPct: args.ivaPctDefault,
    });
  }
  for (const l of args.lineas ?? []) {
    if (!l.monto || l.monto === 0) continue;
    conceptos.push({
      descripcion: l.nombreSnapshot,
      importe: signedImporte(l.signo, l.monto),
      ivaPct: l.ivaPct,
    });
  }
  return conceptos;
}

/** Totales para persistir en Liquidacion antes/después de emitir (misma regla que AFIP AlicIva). */
export function computeLiquidacionTotales(args: {
  bruto: number;
  comision: number;
  gastosAdmin: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
}): { impNeto: number; impIva: number; liquido: number } {
  const conceptos = buildCvlpConceptosList(args).filter((c) => c.importe !== 0);
  const alicuotas = groupAlicuotasIva(
    conceptos.map((c) => ({
      importeBase: c.importe,
      ivaPct: c.ivaPct ?? args.ivaPctDefault,
    })),
    { fallbackIvaPct: args.ivaPctDefault },
  );
  if (alicuotas.length > 0) {
    const impNeto = round2(alicuotas.reduce((s, a) => s + a.BaseImp, 0));
    const impIva = round2(alicuotas.reduce((s, a) => s + a.Importe, 0));
    return {
      impNeto,
      impIva,
      liquido: round2(impNeto + impIva),
    };
  }
  const impNeto = round2(conceptos.reduce((s, c) => s + c.importe, 0));
  const impIva = 0;
  return {
    impNeto,
    impIva,
    liquido: round2(impNeto + impIva),
  };
}
