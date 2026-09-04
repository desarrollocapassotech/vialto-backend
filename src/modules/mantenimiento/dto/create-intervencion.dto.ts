import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TIPOS_INTERVENCION_VALIDOS } from '../tipos-intervencion.const';

export class CreateIntervencionDto {
  @IsString() @IsNotEmpty() vehiculoId: string;
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(TIPOS_INTERVENCION_VALIDOS, { each: true })
  tipos: string[];
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsInt() @Type(() => Number) km?: number;
  @IsOptional() @IsInt() @Type(() => Number) proximoKm?: number;
  @IsOptional() @IsDateString() proximaFecha?: string;
  @IsDateString() fecha: string;
}
