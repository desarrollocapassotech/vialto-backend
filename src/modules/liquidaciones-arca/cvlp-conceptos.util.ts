import { computeAfipGravadoIva, round2 } from './arca-iva.util';
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
 * Conceptos base (Fletes / Comisión) + líneas configurables del tenant.
 * Los gastos del viaje viven en `otrosGastos` y no forman parte del CVLP.
 */
export function buildCvlpConceptosList(args: {
  bruto: number;
  comision: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
}): ConceptoFacturable[] {
  const conceptos: ConceptoFacturable[] = [
    { descripcion: 'Fletes', importe: args.bruto, ivaPct: args.ivaPctDefault },
    { descripcion: 'Comisión', importe: -args.comision, ivaPct: args.ivaPctDefault },
  ];
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

/** Totales para persistir en Liquidacion antes/después de emitir. */
export function computeLiquidacionTotales(args: {
  bruto: number;
  comision: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
}): { impNeto: number; impIva: number; liquido: number } {
  const conceptos = buildCvlpConceptosList(args).filter((c) => c.importe !== 0);
  let impNeto = 0;
  let impIva = 0;
  for (const c of conceptos) {
    const pct = c.ivaPct ?? args.ivaPctDefault;
    const m = computeAfipGravadoIva(c.importe, 0, 0, pct);
    impNeto = round2(impNeto + m.impNeto);
    impIva = round2(impIva + m.impIva);
  }
  return {
    impNeto,
    impIva,
    liquido: round2(impNeto + impIva),
  };
}
