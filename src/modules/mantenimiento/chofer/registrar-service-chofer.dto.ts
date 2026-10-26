import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TAREAS_MANTENIMIENTO_VALIDAS } from '../tareas-mantenimiento.const';

/** Fotos que puede adjuntar el chofer a un service (factura, ticket del taller, el trabajo hecho). */
export const MAX_FOTOS_SERVICE_CHOFER = 5;

/** Service que registra el chofer desde la app de Combustible (el vehículo sale de su asignación). */
export class RegistrarServiceChoferDto {
  @ApiProperty({ example: '2026-10-23', description: 'Fecha del service (día, sin hora)' })
  @IsDateString({}, { message: 'La fecha no es válida.' })
  fecha: string;

  @ApiPropertyOptional({ example: 512340, nullable: true })
  @IsOptional()
  @IsInt({ message: 'El km tiene que ser un número entero.' })
  @Min(0, { message: 'El km no puede ser negativo.' })
  @Type(() => Number)
  km?: number | null;

  @ApiPropertyOptional({ type: [String], description: 'Planes del vehículo que cumple (de `contexto.planes`)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  vehiculoPlanIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['cambio_aceite_motor'], description: 'Además de las de los planes tildados' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(TAREAS_MANTENIMIENTO_VALIDAS, { each: true, message: 'Hay una tarea que no está en el catálogo.' })
  tareas?: string[];

  @ApiPropertyOptional({ nullable: true, description: 'Taller existente (de `contexto.talleres`)' })
  @IsOptional()
  @IsString()
  tallerId?: string | null;

  @ApiPropertyOptional({ example: 'Lubricentro Norte', description: 'Taller que no está en la lista: se busca por nombre o se crea' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  tallerNombre?: string;

  @ApiPropertyOptional({ example: 'Cambio de aceite y filtros', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  descripcion?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'URLs devueltas por POST mantenimiento/chofer/fotos' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FOTOS_SERVICE_CHOFER, { message: `Máximo ${MAX_FOTOS_SERVICE_CHOFER} fotos por service.` })
  @IsUrl({ require_protocol: true }, { each: true })
  adjuntos?: string[];
}
