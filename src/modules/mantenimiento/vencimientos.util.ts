import type { LecturaKm } from '../../core/odometro/odometro.types';
import { ultimaLectura } from '../../core/odometro/odometro.util';
import {
  aDiaUtc,
  calcularVencimiento,
  elegirReferencia,
  type EstadoVencimiento,
  type ResultadoVencimiento,
} from './vencimiento.util';

export interface AsignacionVencimiento {
  vehiculoPlanId: string;
  vehiculo: { id: string; patente: string; tipo: string };
  plan: {
    id: string;
    nombre: string;
    categoria: string;
    intervaloKm: number | null;
    intervaloDias: number | null;
    avisoKm: number | null;
    avisoDias: number | null;
    /** Tareas del plan: el front las precarga en "Registrar service". */
    tareas: string[];
  };
  baseKm: number | null;
  baseFecha: Date | null;
}

export interface OrdenReferencia {
  id: string;
  numero: number;
  km: number | null;
  fecha: Date;
  createdAt: Date;
}

export interface FilaVencimiento extends ResultadoVencimiento {
  vehiculoPlanId: string;
  vehiculo: AsignacionVencimiento['vehiculo'];
  plan: AsignacionVencimiento['plan'];
  /** De dónde arranca el ciclo actual. `id` = id de la OT o `'base'` (lo usa el entidadId de las notificaciones). */
  referencia: { tipo: 'orden' | 'base'; id: string; ordenNumero: number | null; km: number | null; fecha: Date | null } | null;
  odometro: { km: number; fecha: Date; fuente: string; fuenteId: string } | null;
  kmPorDia: number | null;
}

/** La OT más reciente por (fecha, createdAt). */
export function elegirUltimaOrden(ordenes: OrdenReferencia[]): OrdenReferencia | null {
  let ultima: OrdenReferencia | null = null;
  for (const o of ordenes) {
    if (
      !ultima ||
      o.fecha.getTime() > ultima.fecha.getTime() ||
      (o.fecha.getTime() === ultima.fecha.getTime() && o.createdAt.getTime() > ultima.createdAt.getTime())
    ) {
      ultima = o;
    }
  }
  return ultima;
}

/** Km del odómetro hasta el final del día `fecha` (para una OT que cumple un plan pero no tiene km). */
export function kmHastaElDia(lecturas: LecturaKm[], fecha: Date): number | null {
  const tope = aDiaUtc(fecha).getTime();
  const previas = lecturas.filter((l) => aDiaUtc(l.fecha).getTime() <= tope);
  return ultimaLectura(previas)?.km ?? null;
}

export function armarFilaVencimiento(input: {
  asignacion: AsignacionVencimiento;
  ultimaOrden: OrdenReferencia | null;
  kmOdometroALaFechaDeLaOrden: number | null;
  odometro: LecturaKm | null;
  kmPorDia: number | null;
  hoy: Date;
}): FilaVencimiento {
  const { asignacion: a, ultimaOrden, odometro, kmPorDia, hoy } = input;
  const ref = elegirReferencia({
    base: { km: a.baseKm, fecha: a.baseFecha },
    ultimaOrden,
    kmOdometroALaFechaDeLaOrden: input.kmOdometroALaFechaDeLaOrden,
  });
  const resultado = calcularVencimiento({
    plan: a.plan,
    referencia: ref ? { km: ref.km, fecha: ref.fecha } : null,
    odometro: odometro ? { km: odometro.km, fecha: odometro.fecha } : null,
    kmPorDia,
    hoy,
  });
  return {
    vehiculoPlanId: a.vehiculoPlanId,
    vehiculo: a.vehiculo,
    plan: a.plan,
    referencia: ref
      ? {
          tipo: ref.id === 'base' ? 'base' : 'orden',
          id: ref.id,
          ordenNumero: ref.id === 'base' ? null : (ultimaOrden?.numero ?? null),
          km: ref.km,
          fecha: ref.fecha,
        }
      : null,
    odometro: odometro
      ? { km: odometro.km, fecha: odometro.fecha, fuente: odometro.fuente, fuenteId: odometro.fuenteId }
      : null,
    kmPorDia,
    ...resultado,
  };
}

const ORDEN_ESTADO: Record<EstadoVencimiento, number> = { vencido: 0, proximo: 1, sin_datos: 2, ok: 3 };

/** vencido → próximo → sin datos → ok; dentro de cada grupo por fecha estimada (sin fecha al final) y patente. */
export function ordenarVencimientos(filas: FilaVencimiento[]): FilaVencimiento[] {
  return [...filas].sort((a, b) => {
    const e = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
    if (e !== 0) return e;
    const fa = a.fechaEstimada?.getTime() ?? Number.POSITIVE_INFINITY;
    const fb = b.fechaEstimada?.getTime() ?? Number.POSITIVE_INFINITY;
    if (fa !== fb) return fa < fb ? -1 : 1;
    const p = a.vehiculo.patente.localeCompare(b.vehiculo.patente);
    return p !== 0 ? p : a.plan.nombre.localeCompare(b.plan.nombre);
  });
}

export interface ResumenVencimientos {
  vencido: number;
  proximo: number;
  sin_datos: number;
  ok: number;
  total: number;
}

export function resumirVencimientos(filas: FilaVencimiento[]): ResumenVencimientos {
  const r: ResumenVencimientos = { vencido: 0, proximo: 0, sin_datos: 0, ok: 0, total: filas.length };
  for (const f of filas) r[f.estado]++;
  return r;
}
