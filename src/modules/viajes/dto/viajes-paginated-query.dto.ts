import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

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
  @IsString()
  clienteId?: string;

  /** Transportista externo asignado al viaje (`viaje.transportistaId`). */
  @IsOptional()
  @IsString()
  transportistaId?: string;

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
  @Transform(({ value }) => firstQueryString(value))
  @IsIn(['origen', 'destino'])
  tipoUbicacion?: 'origen' | 'destino';

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  @MaxLength(200)
  ubicacion?: string;
}
