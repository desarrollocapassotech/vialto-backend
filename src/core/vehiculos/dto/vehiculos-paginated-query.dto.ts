import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';

export class VehiculosPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patente?: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @IsString()
  marca?: string;

  @IsOptional()
  @IsString()
  modelo?: string;

  /** todos (default) | activos | inactivos */
  @IsOptional()
  @IsIn(['todos', 'activos', 'inactivos'])
  filtroActivo?: 'todos' | 'activos' | 'inactivos';
}
