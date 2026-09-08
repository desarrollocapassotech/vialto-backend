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

/** IVA de una línea de concepto configurable (no flete/comisión). */
function ivaDeConceptoLinea(
  signo: ConceptoSigno,
  monto: number,
  ivaPct: number,
): number {
  const abs = Math.abs(monto);
  if (abs === 0 || !Number.isFinite(ivaPct) || ivaPct === 0) return 0;
  const iva = round2((abs * ivaPct) / 100);
  return signo === 'contra' ? -iva : iva;
}

/**
 * Totales a persistir en Liquidacion.
 * Misma lógica que el modal de creación (`ivaGeneralSobreBase` + conceptos c/IVA propio):
 * el IVA general va solo sobre (bruto − comisión); los conceptos configurables suman
 * su base y su IVA aparte. Gastos/seguro a 0% bajan el neto, no el IVA del flete.
 */
export function computeLiquidacionTotales(args: {
  bruto: number;
  comision: number;
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
  viajes?: { id: string; numero: string | number }[];
}): { impNeto: number; impIva: number; liquido: number } {
  const defaultPct = Number(args.ivaPctDefault);
  const ivaPct = Number.isFinite(defaultPct) ? defaultPct : 0;
  const bruto = round2(args.bruto);
  const comision = round2(args.comision);
  const baseFleteComision = round2(bruto - comision);
  const ivaGeneral =
    ivaPct > 0 ? round2((baseFleteComision * ivaPct) / 100) : 0;

  let conceptosBase = 0;
  let conceptosIva = 0;
  for (const l of args.lineas ?? []) {
    if (!l.monto || l.monto === 0) continue;
    const pct =
      typeof l.ivaPct === 'number' && Number.isFinite(l.ivaPct)
        ? l.ivaPct
        : ivaPct;
    const veces =
      l.modoAplicacion === 'TODOS_LOS_VIAJES' &&
      args.viajes &&
      args.viajes.length > 0
        ? args.viajes.length
        : 1;
    for (let i = 0; i < veces; i++) {
      conceptosBase = round2(conceptosBase + signedImporte(l.signo, l.monto));
      conceptosIva = round2(
        conceptosIva + ivaDeConceptoLinea(l.signo, l.monto, pct),
      );
    }
  }

  const impNeto = round2(baseFleteComision + conceptosBase);
  const impIva = round2(ivaGeneral + conceptosIva);
  return {
    impNeto,
    impIva,
    liquido: round2(impNeto + impIva),
  };
}
