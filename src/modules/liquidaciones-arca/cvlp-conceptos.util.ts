import { round2 } from './arca-iva.util';
import type { ConceptoFacturable } from './arca-cvlp.util';

export type ConceptoSigno = 'favor' | 'contra';

export type ConceptoLineaInput = {
  nombreSnapshot: string;
  signo: ConceptoSigno;
  ivaPct: number;
  monto: number;
  /** Solo informativo (se persiste); los cálculos usan `monto`. */
  cantidad?: number;
  montoUnitario?: number | null;
  orden?: number;
  modoAplicacion?: string;
  viajeId?: string | null;
  /** Aclaración libre opcional; solo se muestra (no afecta montos). */
  detalle?: string | null;
};

/** "Nombre — detalle" si la línea tiene detalle; si no, el nombre solo. */
export function nombreConDetalle(nombre: string, detalle?: string | null): string {
  const d = detalle?.trim();
  return d ? `${nombre} — ${d}` : nombre;
}

export function signedImporte(signo: ConceptoSigno, monto: number): number {
  const abs = Math.abs(monto);
  return signo === 'favor' ? abs : -abs;
}

/**
 * Viaje dentro de una liquidación. `tramosIva` (opcional) reparte su `bruto` por
 * alícuota cuando el viaje tiene tramos de IVA (ver viaje-tramos-transportista.util.ts):
 * si viene, reemplaza a `ivaPct` y la suma de sus bases es el bruto del viaje.
 */
export type ViajeLiquidacionPayload = {
  id: string;
  numero: string | number;
  bruto?: number;
  comision?: number;
  ivaPct?: number;
  tramosIva?: { base: number; ivaPct: number }[];
};

/** Partes del flete de un viaje por alícuota (tramos o un solo % para todo). */
function partesFleteViaje(
  v: ViajeLiquidacionPayload,
  ivaPctDefault: number,
): { base: number; ivaPct: number }[] {
  if (v.tramosIva && v.tramosIva.length > 0) return v.tramosIva;
  return [{ base: v.bruto ?? 0, ivaPct: v.ivaPct ?? ivaPctDefault }];
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
  viajes?: ViajeLiquidacionPayload[];
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
      for (const parte of partesFleteViaje(v, args.ivaPctDefault)) {
        fletesPorIva.set(
          parte.ivaPct,
          round2((fletesPorIva.get(parte.ivaPct) ?? 0) + parte.base),
        );
      }
      // La comisión siempre tributa a la alícuota por defecto del tenant (ej. 21%)
      const comisionIva = args.ivaPctDefault;
      comisionPorIva.set(comisionIva, round2((comisionPorIva.get(comisionIva) ?? 0) + (v.comision ?? 0)));
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
    const nombre = nombreConDetalle(l.nombreSnapshot, l.detalle);

    if (l.modoAplicacion === 'TODOS_LOS_VIAJES' && args.viajes && args.viajes.length > 0) {
      for (const v of args.viajes) {
        conceptos.push({
          descripcion: `${nombre} (Viaje #${v.numero})`,
          importe: signedImporte(l.signo, l.monto),
          ivaPct: l.ivaPct,
        });
      }
    } else {
      let desc = nombre;
      if (l.modoAplicacion === 'VIAJE_PUNTUAL' && l.viajeId && args.viajes) {
        const viaje = args.viajes.find((v) => v.id === l.viajeId);
        if (viaje) desc = `${nombre} (Viaje #${viaje.numero})`;
      }
      // Cantidad × unitario solo para el PDF; el importe sigue siendo `monto`.
      const cantidad = l.cantidad && l.cantidad > 0 ? l.cantidad : 1;
      const tieneCantidad = cantidad !== 1 && l.montoUnitario != null;
      conceptos.push({
        descripcion: desc,
        importe: signedImporte(l.signo, l.monto),
        ivaPct: l.ivaPct,
        ...(tieneCantidad
          ? {
              cantidad,
              precioUnitario: signedImporte(l.signo, l.montoUnitario as number),
            }
          : {}),
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
  viajes?: ViajeLiquidacionPayload[];
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
    let ivaFletes = 0;
    for (const v of args.viajes!) {
      for (const parte of partesFleteViaje(v, ivaPctFallback)) {
        const base = round2(parte.base);
        if (parte.ivaPct > 0) {
          ivaFletes = round2(ivaFletes + round2((base * parte.ivaPct) / 100));
        }
      }
    }
    const ivaComision = ivaPctFallback > 0 ? round2((comision * ivaPctFallback) / 100) : 0;
    ivaGeneral = round2(ivaFletes - ivaComision);
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

/**
 * Cantidad de redondeos a 2 decimales que separan `computeLiquidacionTotales`
 * (redondea por parte de viaje, comisión y concepto) del comprobante ARCA
 * (redondea por alícuota). Define la tolerancia de `compararTotalesCvlp`.
 */
export function redondeosLiquidacion(args: {
  ivaPctDefault: number;
  lineas?: ConceptoLineaInput[];
  viajes?: ViajeLiquidacionPayload[];
}): number {
  const partesViajes = (args.viajes ?? []).reduce(
    (s, v) => s + partesFleteViaje(v, args.ivaPctDefault).length,
    0,
  );
  const nViajes = args.viajes?.length ?? 0;
  const lineas = (args.lineas ?? []).reduce(
    (s, l) =>
      s + (l.modoAplicacion === 'TODOS_LOS_VIAJES' && nViajes > 0 ? nViajes : 1),
    0,
  );
  return partesViajes + lineas + 2;
}

/**
 * Auditoría IVA (nov 2026, H1): compara los totales de la liquidación con los del
 * comprobante que se enviaría a ARCA. Difieren cuando el armado por alícuota de
 * ARCA cambia la cuenta (comisión con otra alícuota que el flete, conceptos en
 * contra al 0% que AFIP no admite como base negativa, etc.). Diferencias de
 * centavos por redondeo (medio centavo por cada redondeo) no cuentan.
 */
export function compararTotalesCvlp(
  sistema: { impNeto: number; impIva: number; liquido: number },
  arca: { impNeto: number; impIva: number; impTotal: number },
  redondeos: number,
): {
  coincide: boolean;
  tolerancia: number;
  difNeto: number;
  difIva: number;
  difTotal: number;
} {
  const tolerancia = round2(Math.max(0.02, Math.ceil(redondeos * 0.5) / 100));
  const difNeto = round2(arca.impNeto - sistema.impNeto);
  const difIva = round2(arca.impIva - sistema.impIva);
  const difTotal = round2(arca.impTotal - sistema.liquido);
  const coincide =
    Math.abs(difNeto) <= tolerancia &&
    Math.abs(difIva) <= tolerancia &&
    Math.abs(difTotal) <= tolerancia;
  return { coincide, tolerancia, difNeto, difIva, difTotal };
}
