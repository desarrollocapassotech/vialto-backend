import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const KM_VALIDO = 'El km tiene que ser un número entero mayor o igual a 0.';
const FECHA_VALIDA = 'La fecha del último service no es válida.';

export class VehiculoBaseDto {
  @ApiPropertyOptional({ example: 'cmpycp0u80007uaoklbs8otoj' })
  @IsString()
  @IsNotEmpty()
  vehiculoId: string;

  @ApiPropertyOptional({ example: 480000, nullable: true, description: 'Km del último service conocido' })
  @IsOptional() @IsInt({ message: KM_VALIDO }) @Min(0, { message: KM_VALIDO }) @Type(() => Number)
  baseKm?: number | null;

  @ApiPropertyOptional({ example: '2026-08-15', nullable: true, description: 'Fecha del último service conocido' })
  @IsOptional() @IsDateString({}, { message: FECHA_VALIDA })
  baseFecha?: string | null;
}

/**
 * Alta masiva de un plan en varias unidades. Una de las dos formas por request:
 * - `vehiculoIds` + `baseKm?`/`baseFecha?`: la misma base para todas (forma de la spec);
 * - `vehiculos`: base por unidad (la tabla de la pantalla de asignación en un solo request).
 */
export class AsignarVehiculosDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  vehiculoIds?: string[];

  @ApiPropertyOptional({ example: 480000, nullable: true })
  @IsOptional() @IsInt({ message: KM_VALIDO }) @Min(0, { message: KM_VALIDO }) @Type(() => Number)
  baseKm?: number | null;

  @ApiPropertyOptional({ example: '2026-08-15', nullable: true })
  @IsOptional() @IsDateString({}, { message: FECHA_VALIDA })
  baseFecha?: string | null;

  @ApiPropertyOptional({ type: [VehiculoBaseDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VehiculoBaseDto)
  vehiculos?: VehiculoBaseDto[];
}
