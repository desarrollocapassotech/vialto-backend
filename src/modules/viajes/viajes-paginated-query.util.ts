import { Prisma } from '@prisma/client';
import { ViajesPaginatedQueryDto } from './dto/viajes-paginated-query.dto';

/** Zona operativa de listados de viajes (misma que el front: America/Argentina/Buenos_Aires). */
export const VIAJES_FECHA_TZ = 'America/Argentina/Buenos_Aires';

function parseYyyyMmDdDia(s: string): string | null {
  const t = s.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/** Inicio del día calendario en Argentina (UTC−3, sin horario de verano). */
function parseYyyyMmDdInicioAr(s: string): Date | null {
  const t = parseYyyyMmDdDia(s);
  if (!t) return null;
  const d = new Date(`${t}T00:00:00.000-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fin del día calendario en Argentina (UTC−3). */
function parseYyyyMmDdFinAr(s: string): Date | null {
  const t = parseYyyyMmDdDia(s);
  if (!t) return null;
  const d = new Date(`${t}T23:59:59.999-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTipoFechaQuery(raw?: string): 'carga' | 'descarga' | undefined {
  const t = raw?.trim();
  return t === 'carga' || t === 'descarga' ? t : undefined;
}

export function parseFechaFiltroQuery(raw?: string): string | undefined {
  return parseYyyyMmDdDia(raw ?? '') ?? undefined;
}

/** Clave lexicográfica en hora Argentina (alineada con el listado del front). */
export function fechaSortKeyArgentina(d: Date): string {
  return d.toLocaleString('sv-SE', {
    timeZone: VIAJES_FECHA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(' ', 'T');
}

export function compareViajesFechaAr(
  a: Date | null,
  b: Date | null,
  dir: ViajesSortDir,
  tieBreak: () => number = () => 0,
): number {
  if (a == null && b == null) return tieBreak();
  if (a == null) return 1;
  if (b == null) return -1;
  const keyA = fechaSortKeyArgentina(a);
  const keyB = fechaSortKeyArgentina(b);
  if (keyA === keyB) return tieBreak();
  const mult = dir === 'asc' ? 1 : -1;
  return keyA < keyB ? -mult : mult;
}

export const VIAJES_SORT_FIELDS = [
  'fecha_carga',
  'fecha_descarga',
  'monto',
  'ganancia_bruta',
] as const;

export type ViajesSortField = (typeof VIAJES_SORT_FIELDS)[number];
export type ViajesSortDir = 'asc' | 'desc';

export function compareViajesOrdenNullable(
  a: number | null,
  b: number | null,
  dir: ViajesSortDir,
  tieBreak: () => number = () => 0,
): number {
  if (a == null && b == null) return tieBreak();
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return tieBreak();
  const mult = dir === 'asc' ? 1 : -1;
  return (a - b) * mult;
}

export function parseViajesSortParams(
  sortBy?: string,
  sortDir?: string,
): { sortBy: ViajesSortField; sortDir: ViajesSortDir } {
  const by =
    sortBy?.trim() === 'fecha_carga' ||
    sortBy?.trim() === 'fecha_descarga' ||
    sortBy?.trim() === 'monto' ||
    sortBy?.trim() === 'ganancia_bruta'
      ? (sortBy.trim() as ViajesSortField)
      : undefined;
  const dirRaw = sortDir?.trim();
  const dir: ViajesSortDir | undefined =
    dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : undefined;
  return resolveViajesSort({ sortBy: by, sortDir: dir });
}

export function resolveViajesSort(
  query: ViajesPaginatedQueryDto,
): { sortBy: ViajesSortField; sortDir: ViajesSortDir } {
  const rawBy = query.sortBy?.trim();
  const sortBy = VIAJES_SORT_FIELDS.includes(rawBy as ViajesSortField)
    ? (rawBy as ViajesSortField)
    : 'fecha_carga';
  const rawDir = query.sortDir?.trim();
  const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : 'desc';
  return { sortBy, sortDir };
}

export function buildViajesPaginatedWhere(
  tenantId: string,
  query: ViajesPaginatedQueryDto,
): Prisma.ViajeWhereInput {
  const where: Prisma.ViajeWhereInput = { tenantId };

  const est = query.estado?.trim();
  if (est) where.estado = est;

  const cid = query.clienteId?.trim();
  if (cid) where.clienteId = cid;

  const tid = query.transportistaId?.trim();
  if (tid) where.transportistaId = tid;

  const tipoFecha = query.tipoFecha?.trim();
  const fDesde = query.fechaDesde?.trim();
  const fHasta = query.fechaHasta?.trim();
  if (tipoFecha === 'carga' || tipoFecha === 'descarga') {
    const range: Prisma.DateTimeNullableFilter = {};
    if (fDesde) {
      const a = parseYyyyMmDdInicioAr(fDesde);
      if (a) range.gte = a;
    }
    if (fHasta) {
      const b = parseYyyyMmDdFinAr(fHasta);
      if (b) range.lte = b;
    }
    if (Object.keys(range).length > 0) {
      if (tipoFecha === 'carga') {
        where.fechaCarga = range;
      } else {
        where.fechaDescarga = range;
      }
    }
  }

  const tipoUbicacion = query.tipoUbicacion?.trim();
  const uq = query.ubicacion?.trim();
  if ((tipoUbicacion === 'origen' || tipoUbicacion === 'destino') && uq) {
    const campo = tipoUbicacion === 'origen' ? 'origen' : 'destino';
    const primeraComa = uq.indexOf(',');
    const soloCiudad =
      primeraComa === -1 ? uq : uq.slice(0, primeraComa).trim();
    const mode = Prisma.QueryMode.insensitive;

    const or: Prisma.ViajeWhereInput[] = [
      { [campo]: { startsWith: uq, mode } },
    ];
    if (soloCiudad.length >= 2 && soloCiudad !== uq) {
      or.push({ [campo]: { equals: soloCiudad, mode } });
      or.push({ [campo]: { startsWith: `${soloCiudad},`, mode } });
    }

    const prevAnd = where.AND;
    const andArr: Prisma.ViajeWhereInput[] = Array.isArray(prevAnd)
      ? [...prevAnd]
      : prevAnd != null
        ? [prevAnd]
        : [];
    where.AND = [...andArr, { OR: or }];
  }

  return where;
}

export function buildViajesPrismaOrderBy(
  sortBy: ViajesSortField,
  sortDir: ViajesSortDir,
): Prisma.ViajeOrderByWithRelationInput | Prisma.ViajeOrderByWithRelationInput[] {
  const nulls = 'last' as const;
  switch (sortBy) {
    case 'fecha_carga':
      return [{ fechaCarga: { sort: sortDir, nulls } }, { id: sortDir }];
    case 'fecha_descarga':
      return [{ fechaDescarga: { sort: sortDir, nulls } }, { id: sortDir }];
    case 'monto':
      return [{ monto: { sort: sortDir, nulls } }, { id: sortDir }];
    default:
      return [{ fechaCarga: { sort: 'desc', nulls } }, { id: 'desc' }];
  }
}
