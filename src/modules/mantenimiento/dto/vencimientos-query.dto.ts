import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CATEGORIAS_PLAN } from './create-plan-mantenimiento.dto';

export const ESTADOS_VENCIMIENTO = ['vencido', 'proximo', 'sin_datos', 'ok'] as const;

export class VencimientosQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehiculoId?: string;

  @ApiPropertyOptional({ enum: ESTADOS_VENCIMIENTO })
  @IsOptional()
  @IsIn(ESTADOS_VENCIMIENTO)
  estado?: (typeof ESTADOS_VENCIMIENTO)[number];

  @ApiPropertyOptional({ enum: CATEGORIAS_PLAN })
  @IsOptional()
  @IsIn(CATEGORIAS_PLAN)
  categoria?: string;

  /** Solo superadmin: empresa sobre la que opera. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;
}
