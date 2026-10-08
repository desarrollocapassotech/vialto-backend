import type { LecturaKm } from '../../core/odometro/odometro.types';
import { compararLecturas } from '../../core/odometro/odometro.util';

export interface OrdenHistorial {
  id: string;
  numero: number;
  tipo: string;
  estado: string;
  km: number | null;
  costoTotal: number;
  tareas: string[];
  descripcion: string | null;
  fecha: Date;
  createdAt: Date;
  taller: { id: string; nombre: string } | null;
  planes: { vehiculoPlanId: string; planNombre: string }[];
  cantidadItems: number;
}

export type EventoHistorial =
  | { tipo: 'orden'; fecha: Date; createdAt: Date; orden: Omit<OrdenHistorial, 'fecha' | 'createdAt'> }
  | { tipo: 'lectura'; fecha: Date; createdAt: Date; km: number; fuente: string; fuenteId: string };

/**
 * Una sola línea de tiempo con las OT (todas, incluidas anuladas) y las lecturas de km,
 * más reciente primero. Las lecturas de fuente `orden_trabajo` se descartan: el km de la OT
 * ya va en su propio evento. Orden con el criterio del odómetro (`compararLecturas`).
 */
export function armarHistorial(ordenes: OrdenHistorial[], lecturas: LecturaKm[]): EventoHistorial[] {
  const items: { clave: LecturaKm; evento: EventoHistorial }[] = [];
  for (const o of ordenes) {
    const { fecha, createdAt, ...orden } = o;
    items.push({
      clave: { km: o.km ?? 0, fecha, createdAt, fuente: 'orden_trabajo', fuenteId: o.id },
      evento: { tipo: 'orden', fecha, createdAt, orden },
    });
  }
  for (const l of lecturas) {
    if (l.fuente === 'orden_trabajo') continue;
    items.push({
      clave: l,
      evento: { tipo: 'lectura', fecha: l.fecha, createdAt: l.createdAt, km: l.km, fuente: l.fuente, fuenteId: l.fuenteId },
    });
  }
  return items.sort((a, b) => compararLecturas(b.clave, a.clave)).map((i) => i.evento);
}
