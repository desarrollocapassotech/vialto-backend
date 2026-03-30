import { IsDateString, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateIntervencionDto {
  @IsOptional() @IsString() vehiculoId?: string;
  @IsOptional() @IsIn(['service', 'aceite', 'filtro', 'cubiertas', 'otro']) tipo?: string;
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsInt() @Type(() => Number) km?: number;
  @IsOptional() @IsInt() @Type(() => Number) proximoKm?: number;
  @IsOptional() @IsDateString() fecha?: string;
}
