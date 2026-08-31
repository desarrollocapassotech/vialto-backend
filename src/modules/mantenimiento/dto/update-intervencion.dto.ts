import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TIPOS_INTERVENCION_VALIDOS } from '../tipos-intervencion.const';

export class UpdateIntervencionDto {
  @IsOptional() @IsString() vehiculoId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(TIPOS_INTERVENCION_VALIDOS, { each: true })
  tipos?: string[];
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsInt() @Type(() => Number) km?: number;
  @IsOptional() @IsInt() @Type(() => Number) proximoKm?: number;
  @IsOptional() @IsDateString() proximaFecha?: string;
  @IsOptional() @IsDateString() fecha?: string;
}
