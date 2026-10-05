/**
 * Cálculo del semáforo de mantenimiento (ok / próximo / vencido / sin datos) para un plan
 * asignado a una unidad. Función pura: no se persiste, se calcula al leer (pantalla de
 * vencimientos, notificaciones, dashboard). Ver docs/mantenimiento-plan.md, sección 4.
 * Todas las fechas se manejan como días en UTC, igual que el resto del sistema.
 */

const MS_DIA = 24 * 60 * 60 * 1000;

export type EstadoVencimiento = 'ok' | 'proximo' | 'vencido' | 'sin_datos';
export type MotivoVencimiento = 'km' | 'fecha';

export interface PlanIntervalos {
  intervaloKm: number | null;
  intervaloDias: number | null;
  avisoKm: number | null;
  avisoDias: number | null;
}

export interface ReferenciaVencimiento {
  km: number | null;
  fecha: Date | null;
}

export interface CalcularVencimientoInput {
  plan: PlanIntervalos;
  /** Última OT cerrada que cumple el plan; si no hay, la base del VehiculoPlan (ver `elegirReferencia`). */
  referencia: ReferenciaVencimiento | null;
  odometro: { km: number; fecha: Date } | null;
  kmPorDia: number | null;
  hoy: Date;
}

export interface ResultadoVencimiento {
  estado: EstadoVencimiento;
  proximoKm: number | null;
  kmRestantes: number | null;
  proximaFecha: Date | null;
  diasRestantes: number | null;
  /** La más temprana entre `proximaFecha` y la proyección por km. */
  fechaEstimada: Date | null;
  /** Qué disparó el estado; `null` con `ok` o `sin_datos`. */
  motivo: MotivoVencimiento | null;
}

type EstadoDimension = 'ok' | 'proximo' | 'vencido';
const GRAVEDAD: Record<EstadoDimension, number> = { ok: 0, proximo: 1, vencido: 2 };

export function aDiaUtc(d: Date): Date {
  const r = new Date(d.getTime());
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function sumarDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * MS_DIA);
}

function estadoDimension(restante: number, aviso: number | null): EstadoDimension {
  if (restante <= 0) return 'vencido';
  if (aviso !== null && restante <= aviso) return 'proximo';
  return 'ok';
}

export function calcularVencimiento(input: CalcularVencimientoInput): ResultadoVencimiento {
  const { plan, referencia, odometro, kmPorDia } = input;
  const hoy = aDiaUtc(input.hoy);

  // ── Dimensión km: necesita intervalo, km de referencia y odómetro ──
  let proximoKm: number | null = null;
  let kmRestantes: number | null = null;
  let estadoKm: EstadoDimension | null = null;
  let fechaKm: Date | null = null;
  if (plan.intervaloKm !== null && referencia?.km != null) {
    proximoKm = referencia.km + plan.intervaloKm;
    if (odometro) {
      kmRestantes = proximoKm - odometro.km;
      estadoKm = estadoDimension(kmRestantes, plan.avisoKm);
      if (kmPorDia !== null && kmPorDia > 0) {
        fechaKm = sumarDias(hoy, Math.floor(kmRestantes / kmPorDia));
      }
    }
  }

  // ── Dimensión fecha: necesita intervalo y fecha de referencia ──
  let proximaFecha: Date | null = null;
  let diasRestantes: number | null = null;
  let estadoFecha: EstadoDimension | null = null;
  if (plan.intervaloDias !== null && referencia?.fecha != null) {
    proximaFecha = sumarDias(aDiaUtc(referencia.fecha), plan.intervaloDias);
    diasRestantes = Math.round((proximaFecha.getTime() - hoy.getTime()) / MS_DIA);
    estadoFecha = estadoDimension(diasRestantes, plan.avisoDias);
  }

  const candidatasFecha = [proximaFecha, fechaKm].filter((f): f is Date => f !== null);
  const fechaEstimada =
    candidatasFecha.length > 0 ? new Date(Math.min(...candidatasFecha.map((f) => f.getTime()))) : null;

  const base = { proximoKm, kmRestantes, proximaFecha, diasRestantes, fechaEstimada };

  if (estadoKm === null && estadoFecha === null) {
    return { ...base, estado: 'sin_datos', motivo: null };
  }

  const gKm = estadoKm === null ? -1 : GRAVEDAD[estadoKm];
  const gFecha = estadoFecha === null ? -1 : GRAVEDAD[estadoFecha];
  const estado = (gKm >= gFecha ? estadoKm : estadoFecha) as EstadoDimension;
  if (estado === 'ok') return { ...base, estado, motivo: null };

  let motivo: MotivoVencimiento;
  if (gKm !== gFecha) {
    motivo = gKm > gFecha ? 'km' : 'fecha';
  } else {
    // Mismo estado por las dos vías: gana la que ocurre primero. Sin proyección por km no
    // se sabe cuándo se cruzó el km → gana km (es el dato medido).
    motivo = fechaKm && proximaFecha && proximaFecha.getTime() < fechaKm.getTime() ? 'fecha' : 'km';
  }
  return { ...base, estado, motivo };
}

export interface ReferenciaElegida extends ReferenciaVencimiento {
  /** Id de la OT usada, o `'base'`. Lo usa el `entidadId` de las notificaciones (MANT-03). */
  id: string;
}

/**
 * Elige el punto de partida del ciclo actual de un plan: la última OT cerrada que lo cumple
 * o, si no hay, la base cargada al asignar el plan. Si la OT no tiene km, se usa el km del
 * odómetro a la fecha de la OT (lo resuelve el service; `null` si no hay lecturas).
 */
export function elegirReferencia(input: {
  base: ReferenciaVencimiento;
  ultimaOrden: { id: string; km: number | null; fecha: Date } | null;
  kmOdometroALaFechaDeLaOrden: number | null;
}): ReferenciaElegida | null {
  const { base, ultimaOrden } = input;
  if (ultimaOrden) {
    return {
      id: ultimaOrden.id,
      fecha: ultimaOrden.fecha,
      km: ultimaOrden.km ?? input.kmOdometroALaFechaDeLaOrden,
    };
  }
  if (base.km === null && base.fecha === null) return null;
  return { id: 'base', km: base.km, fecha: base.fecha };
}
