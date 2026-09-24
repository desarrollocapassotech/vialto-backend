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
  viajes?: {
    id: string;
    numero: string | number;
    bruto?: number;
    comision?: number;
    ivaPct?: number;
  }[];
}): ConceptoFacturable[] {
  const conceptos: ConceptoFacturable[] = [];

  const tieneDesgloseViajes =
    args.viajes &&
    args.viajes.length > 0 &&
    args.viajes.some((v) => v.bruto != null);

  if (tieneDesgloseViajes) {
    const fletesPorIva = new Map<number, number>();
    const comisionPorIva = new Map<number, number>();

    for (const v of args.viajes!) {
      const vIva = v.ivaPct ?? args.ivaPctDefault;
      fletesPorIva.set(vIva, round2((fletesPorIva.get(vIva) ?? 0) + (v.bruto ?? 0)));
      comisionPorIva.set(vIva, round2((comisionPorIva.get(vIva) ?? 0) + (v.comision ?? 0)));
    }

    const hasMultipleIvas = fletesPorIva.size > 1;

    for (const [iva, monto] of fletesPorIva.entries()) {
      if (monto !== 0) {
        conceptos.push({
          descripcion: hasMultipleIvas ? `Fletes (IVA ${iva}%)` : 'Fletes',
          importe: monto,
          ivaPct: iva,
        });
      }
    }
    for (const [iva, monto] of comisionPorIva.entries()) {
      if (monto !== 0) {
        conceptos.push({
          descripcion: hasMultipleIvas ? `Comisión (IVA ${iva}%)` : 'Comisión',
          importe: -monto,
          ivaPct: iva,
        });
      }
    }
  } else {
    conceptos.push({ descripcion: 'Fletes', importe: args.bruto, ivaPct: args.ivaPctDefault });
    conceptos.push({ descripcion: 'Comisión', importe: -args.comision, ivaPct: args.ivaPctDefault });
  }
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
  viajes?: {
    id: string;
    numero: string | number;
    bruto?: number;
    comision?: number;
    ivaPct?: number;
  }[];
}): { impNeto: number; impIva: number; liquido: number } {
  const defaultPct = Number(args.ivaPctDefault);
  const ivaPctFallback = Number.isFinite(defaultPct) ? defaultPct : 0;
  const bruto = round2(args.bruto);
  const comision = round2(args.comision);
  const baseFleteComision = round2(bruto - comision);

  let ivaGeneral = 0;

  const tieneDesgloseViajes =
    args.viajes &&
    args.viajes.length > 0 &&
    args.viajes.some((v) => v.bruto != null);

  if (tieneDesgloseViajes) {
    for (const v of args.viajes!) {
      const vIva = v.ivaPct ?? ivaPctFallback;
      const vBase = round2((v.bruto ?? 0) - (v.comision ?? 0));
      if (vIva > 0) {
        ivaGeneral = round2(ivaGeneral + round2((vBase * vIva) / 100));
      }
    }
  } else {
    ivaGeneral =
      ivaPctFallback > 0
        ? round2((baseFleteComision * ivaPctFallback) / 100)
        : 0;
  }

  let conceptosBase = 0;
  let conceptosIva = 0;
  for (const l of args.lineas ?? []) {
    if (!l.monto || l.monto === 0) continue;
    const pct =
      typeof l.ivaPct === 'number' && Number.isFinite(l.ivaPct)
        ? l.ivaPct
        : ivaPctFallback;
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
