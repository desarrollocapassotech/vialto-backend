import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';

export class ChoferesPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  dni?: string;

  /** todos (default) | activos | inactivos */
  @IsOptional()
  @IsIn(['todos', 'activos', 'inactivos'])
  filtroActivo?: 'todos' | 'activos' | 'inactivos';
}
