import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class HistorialQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Desde (inclusive)' })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Hasta (inclusive, todo el día)' })
  @IsOptional()
  @IsDateString()
  hasta?: string;

  /** Solo superadmin: empresa sobre la que opera. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;
}
