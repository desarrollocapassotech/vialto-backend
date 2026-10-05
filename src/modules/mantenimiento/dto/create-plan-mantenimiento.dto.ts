import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TAREAS_MANTENIMIENTO_VALIDAS } from '../tareas-mantenimiento.const';

const ENTERO_POSITIVO = 'Tiene que ser un número entero mayor a 0.';

export const CATEGORIAS_PLAN = ['mecanico', 'documental'] as const;
/** Mismos tipos que `CreateVehiculoDto.tipo`. */
export const TIPOS_VEHICULO_PLAN = ['tractor', 'semirremolque', 'camion', 'acoplado', 'utilitario', 'otro'] as const;

export class CreatePlanMantenimientoDto {
  @ApiProperty({ example: 'Service motor (aceite + filtros)' })
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el nombre del plan.' })
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nombre: string;

  @ApiProperty({ enum: CATEGORIAS_PLAN })
  @IsIn(CATEGORIAS_PLAN, { message: 'La categoría debe ser mecánico o documental.' })
  categoria: string;

  @ApiPropertyOptional({ enum: TIPOS_VEHICULO_PLAN, nullable: true, description: 'null = cualquier tipo' })
  @IsOptional()
  @IsIn(TIPOS_VEHICULO_PLAN)
  tipoVehiculo?: string | null;

  @ApiPropertyOptional({ example: 20000, nullable: true })
  @IsOptional() @IsInt({ message: ENTERO_POSITIVO }) @Min(1, { message: ENTERO_POSITIVO }) @Type(() => Number)
  intervaloKm?: number | null;

  @ApiPropertyOptional({ example: 180, nullable: true })
  @IsOptional() @IsInt({ message: ENTERO_POSITIVO }) @Min(1, { message: ENTERO_POSITIVO }) @Type(() => Number)
  intervaloDias?: number | null;

  @ApiPropertyOptional({ example: 2000, nullable: true, description: 'Anticipación del aviso, en km' })
  @IsOptional() @IsInt({ message: ENTERO_POSITIVO }) @Min(1, { message: ENTERO_POSITIVO }) @Type(() => Number)
  avisoKm?: number | null;

  @ApiPropertyOptional({ example: 15, nullable: true, description: 'Anticipación del aviso, en días' })
  @IsOptional() @IsInt({ message: ENTERO_POSITIVO }) @Min(1, { message: ENTERO_POSITIVO }) @Type(() => Number)
  avisoDias?: number | null;

  @ApiPropertyOptional({ type: [String], example: ['cambio_aceite_motor', 'revision_filtros'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(TAREAS_MANTENIMIENTO_VALIDAS, { each: true, message: 'Hay una tarea que no está en el catálogo.' })
  tareas?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
