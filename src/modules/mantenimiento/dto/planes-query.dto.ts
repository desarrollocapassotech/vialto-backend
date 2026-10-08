import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CATEGORIAS_PLAN } from './create-plan-mantenimiento.dto';

export class PlanesQueryDto {
  @ApiPropertyOptional({ enum: CATEGORIAS_PLAN })
  @IsOptional()
  @IsIn(CATEGORIAS_PLAN)
  categoria?: string;

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
