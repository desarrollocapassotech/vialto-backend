import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class TalleresQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Sin filtro trae activos e inactivos' })
  @IsOptional()
  @IsIn(['true', 'false'])
  activo?: string;

  /** Solo superadmin: empresa sobre la que opera. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;
}
