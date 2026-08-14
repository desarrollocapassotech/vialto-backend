import { round2 } from './arca-iva.util';
import type { ConceptoFacturable } from './arca-cvlp.util';

export type ConceptoSigno = 'favor' | 'contra';

export type ConceptoLineaInput = {
  nombreSnapshot: string;
  signo: ConceptoSigno;
  ivaPct: number;
  monto: number;
  orden?: number;
  modoAplicacion?: string;
  viajeId?: string | null;
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
  viajes?: { id: string; numero: string | number }[];
}): ConceptoFacturable[] {
  const conceptos: ConceptoFacturable[] = [
    { descripcion: 'Fletes', importe: args.bruto, ivaPct: args.ivaPctDefault },
    { descripcion: 'Comisión', importe: -args.comision, ivaPct: args.ivaPctDefault },
  ];
  for (const l of args.lineas ?? []) {
    if (!l.monto || l.monto === 0) continue;
    
    if (l.modoAplicacion === 'TODOS_LOS_VIAJES' && args.viajes && args.viajes.length > 0) {
      for (const v of args.viajes) {
        conceptos.push({
          descripcion: `${l.nombreSnapshot} (Viaje #${v.numero})`,
          importe: signedImporte(l.signo, l.monto),
          ivaPct: l.ivaPct,
        });
      }
    } else {
      let desc = l.nombreSnapshot;
      if (l.modoAplicacion === 'VIAJE_PUNTUAL' && l.viajeId && args.viajes) {
        const viaje = args.viajes.find((v) => v.id === l.viajeId);
        if (viaje) desc = `${l.nombreSnapshot} (Viaje #${viaje.numero})`;
      }
      conceptos.push({
        descripcion: desc,
        importe: signedImporte(l.signo, l.monto),
        ivaPct: l.ivaPct,
      });
    }
  }
  return conceptos;
}

/**
 * Totales a persistir en Liquidacion.
 * El IVA de la liquidación (`ivaPctDefault`) aplica a flete, comisión y conceptos.
 * Así el campo IVA del formulario es la única fuente de verdad (no se remapea a
 * alícuotas AFIP ni se pisa con el IVA del catálogo de conceptos).
 */
export function computeLiquidacionTotales(args: {
  bruto: number;
  comision: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
  viajes?: { id: string; numero: string | number }[];
}): { impNeto: number; impIva: number; liquido: number } {
  const pct = Number(args.ivaPctDefault);
  const rate = Number.isFinite(pct) ? pct : 0;
  const conceptos = buildCvlpConceptosList(args).filter((c) => c.importe !== 0);
  let impNeto = 0;
  for (const c of conceptos) {
    impNeto = round2(impNeto + round2(c.importe));
  }
  const impIva = round2((impNeto * rate) / 100);
  return {
    impNeto,
    impIva,
    liquido: round2(impNeto + impIva),
  };
}
