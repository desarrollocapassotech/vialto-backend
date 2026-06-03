import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';

/** Valores de catálogo alineados con el frontend (`unidadesProducto`). */
export const PRODUCTO_UNIDADES_CATALOGO = [
  'kg',
  'tn',
  'unidades',
  'rollos',
  'pallets',
  'bultos',
  'cajas',
  'm3',
  'litros',
] as const;

export class ProductosPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  /** todos (default) | activos | inactivos */
  @IsOptional()
  @IsIn(['todos', 'activos', 'inactivos'])
  filtroActivo?: 'todos' | 'activos' | 'inactivos';

  /** Filtro exacto por unidad de medida del catálogo. */
  @IsOptional()
  @IsIn([...PRODUCTO_UNIDADES_CATALOGO])
  unidadMedida?: (typeof PRODUCTO_UNIDADES_CATALOGO)[number];
}
