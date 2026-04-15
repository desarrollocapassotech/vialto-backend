import type {
  DashboardPeriodKind,
  ResolvedDashboardPeriod,
} from './dashboard-period';

/** Zona usada para “mes / semana” alineados al calendario operativo (Argentina). */
export const DASHBOARD_SIN_FACTURAR_TZ = 'America/Argentina/Buenos_Aires';

export type SinFacturarArHalfOpen = {
  /** YYYY-MM-DD primera fecha incluida */
  fromInclusive: string;
  /** YYYY-MM-DD primera fecha excluida */
  toExclusive: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD civil en `timeZone` para el instante `d`. */
function ymdInTimezone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Suma días de calendario a YYYY-MM-DD (proleptic Gregorian, UTC date math). */
function ymdAddDaysCalendar(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Fecha inválida: ${ymd}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Mes calendario actual en TZ (primera fila del mes → primera del mes siguiente, half-open). */
function arCalendarMonthRangeNow(now: Date, tz: string): SinFacturarArHalfOpen {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const mo = Number(parts.find((p) => p.type === 'month')!.value);
  const fromInclusive = `${y}-${pad2(mo)}-01`;
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const toExclusive = `${ny}-${pad2(nm)}-01`;
  return { fromInclusive, toExclusive };
}

function arPreviousCalendarMonth(current: SinFacturarArHalfOpen): SinFacturarArHalfOpen {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(current.fromInclusive);
  if (!m) throw new Error('Rango inválido');
  let y = Number(m[1]);
  let mo = Number(m[2]);
  if (mo === 1) {
    y -= 1;
    mo = 12;
  } else {
    mo -= 1;
  }
  const fromInclusive = `${y}-${pad2(mo)}-01`;
  return { fromInclusive, toExclusive: current.fromInclusive };
}

/**
 * Convierte [start, end) en UTC a límites de fecha civil en Argentina para comparar con DATE en SQL.
 * `end` es exclusivo: el primer instante fuera del período.
 */
function utcHalfOpenToArDayRange(
  start: Date,
  end: Date,
  tz: string,
): SinFacturarArHalfOpen {
  return {
    fromInclusive: ymdInTimezone(start, tz),
    toExclusive: ymdInTimezone(end, tz),
  };
}

/**
 * Rangos [from, to) en fechas calendario (ART) para la tarjeta «Sin facturar» del dashboard.
 * No usa comparación directa de timestamps UTC del resto del tablero, para evitar desfasajes
 * (servidor en UTC vs operación en Argentina) y priorizar fecha de carga en SQL.
 */
export function sinFacturarArHalfOpenRanges(
  kind: DashboardPeriodKind,
  resolved: ResolvedDashboardPeriod,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): { current: SinFacturarArHalfOpen; previous: SinFacturarArHalfOpen } {
  const tz = DASHBOARD_SIN_FACTURAR_TZ;

  if (kind === 'month') {
    const current = arCalendarMonthRangeNow(now, tz);
    const previous = arPreviousCalendarMonth(current);
    return { current, previous };
  }

  if (kind === 'custom' && customFrom && customTo) {
    const from = customFrom.slice(0, 10);
    const to = customTo.slice(0, 10);
    return {
      current: {
        fromInclusive: from,
        toExclusive: ymdAddDaysCalendar(to, 1),
      },
      previous: utcHalfOpenToArDayRange(
        resolved.prevStart,
        resolved.prevEnd,
        tz,
      ),
    };
  }

  return {
    current: utcHalfOpenToArDayRange(resolved.start, resolved.end, tz),
    previous: utcHalfOpenToArDayRange(resolved.prevStart, resolved.prevEnd, tz),
  };
}
