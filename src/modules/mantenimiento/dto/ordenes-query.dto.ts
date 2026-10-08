import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/dto/pagination-query.dto';
import { TIPOS_ORDEN } from '../ordenes.util';

export class OrdenesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehiculoId?: string;

  @ApiPropertyOptional({ enum: TIPOS_ORDEN })
  @IsOptional()
  @IsIn(TIPOS_ORDEN)
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tallerId?: string;

  @ApiPropertyOptional({ enum: ['cerrada', 'anulada'] })
  @IsOptional()
  @IsIn(['abierta', 'en_curso', 'cerrada', 'anulada'])
  estado?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Desde (inclusive)' })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Hasta (inclusive)' })
  @IsOptional()
  @IsDateString()
  hasta?: string;

  /** Solo superadmin: empresa sobre la que opera. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;
}
