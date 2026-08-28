import type { ConceptoFacturable } from './arca-cvlp.util';
import { resolveIvaPct, round2 } from './arca-iva.util';
import { numeroVisibleViaje } from '../viajes/viaje-numero-visible.util';

/** Neto de la línea: cantidad × precio (2 decimales) si ambos están; si no, `monto`. */
export function importeNetoLineaViaje(v: {
  monto: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
}): number {
  if (v.cantidadFactura != null && v.precioUnitarioFactura != null) {
    return round2(v.cantidadFactura * v.precioUnitarioFactura);
  }
  return round2(v.monto ?? 0);
}

export interface FacturaLineaInput {
  producto?: string;
  descripcion: string;
  cantidad?: number;
  precioUnitario?: number;
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
      producto: l.producto,
      descripcion: l.descripcion.trim(),
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      importe: l.importe,
      ivaPct: l.ivaPct ?? ivaPctDefault,
    }));
}

type ViajeSnap = {
  numero: string;
  numeroIdentificacionPersonalizado?: string | null;
  monto: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
  origen?: string | null;
  destino?: string | null;
  fechaCarga?: Date | null;
};

/** Líneas por defecto a partir de la factura y sus viajes vinculados. */
export function defaultFacturaLineas(
  factura: { importe: number; ivaPct?: number | null },
  viajes: ViajeSnap[],
): FacturaLineaInput[] {
  const ivaPct = resolveIvaPct(factura.ivaPct);
  if (viajes.length > 0) {
    return viajes.map((v) => {
      const ruta = [v.origen, v.destino].filter(Boolean).join(" — ");
      const fechaTxt = v.fechaCarga ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(v.fechaCarga) : "";
      
      const partesDesc = [ruta, fechaTxt].filter(Boolean).join(" - ");
      const descripcion = partesDesc || `Viaje #${numeroVisibleViaje(v)}`;

      return {
        producto: v.numeroIdentificacionPersonalizado || `#${v.numero}`,
        descripcion,
        cantidad: v.cantidadFactura ?? undefined,
        precioUnitario: v.precioUnitarioFactura ?? undefined,
        importe: importeNetoLineaViaje(v),
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
