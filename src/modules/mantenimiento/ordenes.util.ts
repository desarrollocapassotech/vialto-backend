import type { LecturaKm } from '../../core/odometro/odometro.types';
import { compararLecturas } from '../../core/odometro/odometro.util';
import { KM_DELTA_PLAUSIBLE_MAX } from '../../shared/util/combustible-km.constants';

export const TIPOS_ORDEN = ['preventivo', 'correctivo'] as const;
export const TIPOS_ITEM_ORDEN = ['general', 'mano_obra', 'repuesto', 'servicio_externo'] as const;

export interface ItemOrdenInput {
  tipo?: string;
  descripcion: string;
  cantidad?: number;
  costoUnitario: number;
}

export interface ItemOrdenCalculado {
  tipo: string;
  descripcion: string;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Subtotales y total de una OT: siempre se calculan acá, nunca se aceptan del cliente. */
export function calcularItems(items: ItemOrdenInput[] | undefined): { items: ItemOrdenCalculado[]; costoTotal: number } {
  const calculados = (items ?? []).map((i) => {
    const cantidad = i.cantidad ?? 1;
    return {
      tipo: i.tipo ?? 'general',
      descripcion: i.descripcion.trim(),
      cantidad,
      costoUnitario: i.costoUnitario,
      subtotal: round2(cantidad * i.costoUnitario),
    };
  });
  return { items: calculados, costoTotal: round2(calculados.reduce((s, i) => s + i.subtotal, 0)) };
}

const FUENTE_LABEL: Record<string, string> = {
  carga: 'carga de combustible',
  edicion: 'corrección manual de km',
  orden_trabajo: 'orden de trabajo',
};

const fmtKm = (km: number) => km.toLocaleString('es-AR');
const fmtFecha = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const describir = (l: LecturaKm) => `${fmtKm(l.km)} km el ${fmtFecha(l.fecha)} (${FUENTE_LABEL[l.fuente] ?? l.fuente})`;

/**
 * Aviso (no bloqueante) si el km de una OT no cierra con las lecturas vecinas del odómetro:
 * menor que la anterior, mayor que la siguiente, o un salto mayor a KM_DELTA_PLAUSIBLE_MAX
 * desde la anterior. `lecturas` no debe incluir la propia OT. Devuelve `null` si está bien.
 */
export function evaluarKmOrden(
  orden: { km: number | null | undefined; fecha: Date; createdAt?: Date },
  lecturas: LecturaKm[],
): string | null {
  if (orden.km === null || orden.km === undefined) return null;
  const propia: LecturaKm = {
    km: orden.km,
    fecha: orden.fecha,
    fuente: 'orden_trabajo',
    fuenteId: '__orden__',
    createdAt: orden.createdAt ?? new Date(),
  };

  let anterior: LecturaKm | null = null;
  let posterior: LecturaKm | null = null;
  for (const l of lecturas) {
    const c = compararLecturas(l, propia);
    if (c < 0 && (!anterior || compararLecturas(l, anterior) > 0)) anterior = l;
    if (c > 0 && (!posterior || compararLecturas(l, posterior) < 0)) posterior = l;
  }

  const avisos: string[] = [];
  if (anterior && orden.km < anterior.km) {
    avisos.push(`El km (${fmtKm(orden.km)}) es menor que la lectura anterior: ${describir(anterior)}.`);
  }
  if (posterior && orden.km > posterior.km) {
    avisos.push(`El km (${fmtKm(orden.km)}) es mayor que la lectura siguiente: ${describir(posterior)}.`);
  }
  if (anterior && orden.km - anterior.km > KM_DELTA_PLAUSIBLE_MAX) {
    avisos.push(
      `Hay ${fmtKm(orden.km - anterior.km)} km desde la lectura anterior (${fmtFecha(anterior.fecha)}). Revisá que esté bien.`,
    );
  }
  return avisos.length > 0 ? avisos.join(' ') : null;
}
