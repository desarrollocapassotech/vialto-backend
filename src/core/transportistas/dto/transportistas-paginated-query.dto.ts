import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';
import { PROVEEDOR_TIPOS } from '../../../shared/util/proveedor-tipo';

export const PROVEEDOR_TIPO_FILTRO = [...PROVEEDOR_TIPOS, 'todos'] as const;
export type ProveedorTipoFiltro = (typeof PROVEEDOR_TIPO_FILTRO)[number];

/**
 * Filtro de proveedores para los listados. Sin `tipo` = solo transportistas: así todos
 * los selectores de siempre (viajes, choferes, vehículos, liquidaciones) siguen sin
 * cambios. Base de datos y Cuenta corriente piden `tipo=todos`.
 */
export class ProveedoresFiltroQueryDto {
  @IsOptional()
  @IsIn(PROVEEDOR_TIPO_FILTRO)
  tipo?: ProveedorTipoFiltro;

  /** `true` = solo activos, `false` = solo desactivados; sin valor = todos. */
  @IsOptional()
  @IsIn(['true', 'false'])
  activo?: 'true' | 'false';
}

export class TransportistasPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  idFiscal?: string;

  @IsOptional()
  @IsIn(PROVEEDOR_TIPO_FILTRO)
  tipo?: ProveedorTipoFiltro;

  /** Con `tipo=otro`: solo los de esa categoría (ej. "Combustible"). */
  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  activo?: 'true' | 'false';
}
