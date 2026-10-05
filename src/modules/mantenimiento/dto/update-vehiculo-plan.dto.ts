import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

const KM_VALIDO = 'El km tiene que ser un número entero mayor o igual a 0.';

/** Edición de una asignación plan ↔ unidad; `null` en la base la borra. */
export class UpdateVehiculoPlanDto {
  @ApiPropertyOptional({ example: 480000, nullable: true })
  @IsOptional() @IsInt({ message: KM_VALIDO }) @Min(0, { message: KM_VALIDO }) @Type(() => Number)
  baseKm?: number | null;

  @ApiPropertyOptional({ example: '2026-08-15', nullable: true })
  @IsOptional() @IsDateString({}, { message: 'La fecha del último service no es válida.' })
  baseFecha?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
