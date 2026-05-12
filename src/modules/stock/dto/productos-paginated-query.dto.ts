import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';

export class ProductosPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  /** todos (default) | activos | inactivos */
  @IsOptional()
  @IsIn(['todos', 'activos', 'inactivos'])
  filtroActivo?: 'todos' | 'activos' | 'inactivos';
}
