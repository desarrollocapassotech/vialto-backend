import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TAREAS_MANTENIMIENTO_VALIDAS } from '../tareas-mantenimiento.const';
import { TIPOS_ITEM_ORDEN, TIPOS_ORDEN } from '../ordenes.util';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ItemOrdenDto {
  @ApiPropertyOptional({ enum: TIPOS_ITEM_ORDEN, default: 'general' })
  @IsOptional()
  @IsIn(TIPOS_ITEM_ORDEN)
  tipo?: string;

  @ApiProperty({ example: 'Aceite 15W40 x 40 L' })
  @IsString()
  @IsNotEmpty({ message: 'Cada línea de costo necesita una descripción.' })
  @MaxLength(300)
  @Transform(trim)
  descripcion: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'La cantidad tiene que ser un número.' })
  @Min(0.0001, { message: 'La cantidad tiene que ser mayor a 0.' })
  @Type(() => Number)
  cantidad?: number;

  @ApiProperty({ example: 185000 })
  @IsNumber({}, { message: 'El importe tiene que ser un número.' })
  @Min(0, { message: 'El importe no puede ser negativo.' })
  @Type(() => Number)
  costoUnitario: number;
}

export class CreateOrdenTrabajoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Elegí la unidad.' })
  vehiculoId: string;

  @ApiProperty({ enum: TIPOS_ORDEN })
  @IsIn(TIPOS_ORDEN, { message: 'El tipo tiene que ser preventivo o correctivo.' })
  tipo: string;

  @ApiProperty({ example: '2026-10-01', description: 'Fecha del trabajo (se guarda como día, sin hora)' })
  @IsDateString({}, { message: 'La fecha no es válida.' })
  fecha: string;

  @ApiPropertyOptional({ example: 512340, nullable: true })
  @IsOptional()
  @IsInt({ message: 'El km tiene que ser un número entero.' })
  @Min(0, { message: 'El km no puede ser negativo.' })
  @Type(() => Number)
  km?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  tallerId?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['cambio_aceite_motor'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(TAREAS_MANTENIMIENTO_VALIDAS, { each: true, message: 'Hay una tarea que no está en el catálogo.' })
  tareas?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  descripcion?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'URLs devueltas por POST mantenimiento/ordenes/adjuntos' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Máximo 10 adjuntos por orden.' })
  @IsUrl({ require_protocol: true }, { each: true })
  adjuntos?: string[];

  @ApiPropertyOptional({ type: [ItemOrdenDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemOrdenDto)
  items?: ItemOrdenDto[];

  @ApiPropertyOptional({ type: [String], description: 'Asignaciones plan ↔ unidad (de esta misma unidad) que cumple la OT' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  vehiculoPlanIds?: string[];
}
