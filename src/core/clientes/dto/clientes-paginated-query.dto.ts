import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';

export class ClientesPaginatedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  idFiscal?: string;

  @IsOptional()
  @IsString()
  pais?: string;
}
