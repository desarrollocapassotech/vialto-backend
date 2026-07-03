import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function firstQueryString(val: unknown): string | undefined {
  if (val == null) return undefined;
  const s = Array.isArray(val) ? val[0] : val;
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/** Query GET /facturacion/facturas/paginated */
export class FacturasPaginatedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 10;

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  @MaxLength(120)
  numero?: string;

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsIn(['cliente', 'transportista_externo'])
  tipo?: 'cliente' | 'transportista_externo';

  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsString()
  clienteId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  emisionDesde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  emisionHasta?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vencimientoDesde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vencimientoHasta?: string;

  /** Estado de lectura: pendiente | cobrada | vencida */
  @IsOptional()
  @Transform(({ value }) => firstQueryString(value))
  @IsIn(['pendiente', 'cobrada', 'vencida'])
  estado?: 'pendiente' | 'cobrada' | 'vencida';
}
