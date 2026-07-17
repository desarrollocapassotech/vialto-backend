import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Express puede entregar `string | string[]` en query; nos quedamos con el primer valor. */
function firstQueryString(val: unknown): string | undefined {
  if (val == null) return undefined;
  const s = Array.isArray(val) ? val[0] : val;
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Query GET /viajes/paginated: paginación + filtros opcionales.
 * Todo en una sola clase (sin extender PaginationQueryDto) para que
 * `class-transformer` + ValidationPipe rellenen bien los query params en Nest.
 */
export class ViajesPaginatedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  clienteId?: string;

  /** Transportista externo asignado al viaje (`viaje.transportistaId`). */
  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  transportistaId?: string;

  /**
   * Si es true, excluye viajes que ya tienen una liquidación activa
   * (estado ≠ anulado) para el transportista filtrado — o cualquier
   * liquidación activa si no se envió `transportistaId`.
   * Usado por liquidación múltiple manual.
   */
  @IsOptional()
  @Transform(({ value }) => {
    const s = firstQueryString(value);
    if (s === undefined) return undefined;
    return s === '1' || s.toLowerCase() === 'true';
  })
  @IsBoolean()
  sinLiquidacionActiva?: boolean;

  /** Filtrar rango sobre `fechaCarga` o `fechaDescarga` (requiere al menos una fecha). */
  @IsOptional()
  @IsIn(['carga', 'descarga'])
  tipoFecha?: 'carga' | 'descarga';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaDesde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaHasta?: string;

  /** Filtrar por `origen` o `destino` igual a esta etiqueta (ciudad elegida en el combobox). */
  @IsOptional()
  @Transform(({ value }) => {
    const s = firstQueryString(value);
    if (s === 'origen' || s === 'destino') return s;
    return undefined;
  })
  tipoUbicacion?: 'origen' | 'destino';

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  @MaxLength(200)
  ubicacion?: string;

  /**
   * Filtro global por fecha de carga relativo al día actual (Argentina, UTC-3).
   * - `todos` (default): muestra todos los viajes.
   * - `desde_hoy`: solo viajes con fechaCarga >= inicio del día actual.
   * - `anteriores`: solo viajes con fechaCarga < inicio del día actual.
   */
  @IsOptional()
  @Transform(({ value }) => {
    const s = firstQueryString(value);
    if (s === 'todos' || s === 'desde_hoy' || s === 'anteriores') return s;
    return undefined;
  })
  @IsIn(['todos', 'desde_hoy', 'anteriores'])
  periodo?: 'todos' | 'desde_hoy' | 'anteriores';

  /** Campo de ordenamiento del listado paginado. */
  @IsOptional()
  @Transform(({ value }) => {
    const s = firstQueryString(value);
    if (
      s === 'fecha_carga' ||
      s === 'fecha_descarga' ||
      s === 'monto' ||
      s === 'ganancia_bruta'
    ) {
      return s;
    }
    return undefined;
  })
  sortBy?: 'fecha_carga' | 'fecha_descarga' | 'monto' | 'ganancia_bruta';

  @IsOptional()
  @Transform(({ value }) => {
    const s = firstQueryString(value);
    if (s === 'asc' || s === 'desc') return s;
    return undefined;
  })
  sortDir?: 'asc' | 'desc';
}
