/** Límites de período [start, end) en hora local del servidor. */

export type DashboardPeriodKind = 'week' | 'month' | '3months' | 'custom';

export type ResolvedDashboardPeriod = {
  kind: DashboardPeriodKind;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
};

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function parseYmdLocal(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error('Fecha inválida (usar YYYY-MM-DD)');
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day, 0, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) {
    throw new Error('Fecha inválida');
  }
  return d;
}

/**
 * Resuelve período actual y el inmediatamente anterior (misma “forma” de ventana).
 */
export function resolveDashboardPeriod(
  kind: DashboardPeriodKind,
  fromStr?: string,
  toStr?: string,
  now: Date = new Date(),
): ResolvedDashboardPeriod {
  if (kind === 'custom') {
    if (!fromStr || !toStr) {
      throw new Error('Período personalizado: indicá fecha desde y hasta (YYYY-MM-DD)');
    }
    const start = parseYmdLocal(fromStr);
    const toDate = parseYmdLocal(toStr);
    const end = addDays(toDate, 1);
    if (end <= start) {
      throw new Error('La fecha hasta debe ser posterior o igual a la fecha desde');
    }
    const ms = end.getTime() - start.getTime();
    const prevEnd = start;
    const prevStart = new Date(prevEnd.getTime() - ms);
    return { kind, start, end, prevStart, prevEnd };
  }

  if (kind === 'week') {
    const start = startOfWeekMonday(now);
    const end = addDays(start, 7);
    const prevEnd = start;
    const prevStart = addDays(start, -7);
    return { kind, start, end, prevStart, prevEnd };
  }

  if (kind === 'month') {
    const start = startOfMonth(now);
    const end = addMonths(start, 1);
    const prevEnd = start;
    const prevStart = addMonths(start, -1);
    return { kind, start, end, prevStart, prevEnd };
  }

  // 3months: mes actual + dos meses anteriores (tres meses de calendario)
  const start = addMonths(startOfMonth(now), -2);
  const end = addMonths(startOfMonth(now), 1);
  const prevEnd = start;
  const prevStart = addMonths(start, -3);
  return { kind, start, end, prevStart, prevEnd };
}
