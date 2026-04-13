import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
}
