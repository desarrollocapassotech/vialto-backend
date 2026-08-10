import type { ConceptoFacturable } from './arca-cvlp.util';
import { resolveIvaPct } from './arca-iva.util';
import { numeroVisibleViaje } from '../viajes/viaje-numero-visible.util';

export interface FacturaLineaInput {
  descripcion: string;
  /** Importe neto (sin IVA) de la línea. */
  importe: number;
  ivaPct?: number;
}

export function buildFacturaConceptosList(
  lineas: FacturaLineaInput[],
  ivaPctDefault: number,
): ConceptoFacturable[] {
  return lineas
    .filter((l) => l.descripcion.trim() && l.importe !== 0)
    .map((l) => ({
      descripcion: l.descripcion.trim(),
      importe: l.importe,
      ivaPct: l.ivaPct ?? ivaPctDefault,
    }));
}

type ViajeSnap = {
  numero: string;
  numeroIdentificacionPersonalizado?: string | null;
  monto: number | null;
  origen?: string | null;
  destino?: string | null;
};

/** Líneas por defecto a partir de la factura y sus viajes vinculados. */
export function defaultFacturaLineas(
  factura: { importe: number; ivaPct?: number | null },
  viajes: ViajeSnap[],
): FacturaLineaInput[] {
  const ivaPct = resolveIvaPct(factura.ivaPct);
  if (viajes.length > 0) {
    return viajes.map((v) => {
      const ruta =
        v.origen && v.destino ? ` ${v.origen} — ${v.destino}` : '';
      return {
        descripcion: `Viaje #${numeroVisibleViaje(v)}${ruta}`,
        importe: v.monto ?? 0,
        ivaPct,
      };
    });
  }
  return [
    {
      descripcion: 'Servicios de transporte',
      importe: factura.importe,
      ivaPct,
    },
  ];
}
