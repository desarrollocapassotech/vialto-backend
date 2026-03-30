import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateIntervencionDto {
  @IsString() @IsNotEmpty() vehiculoId: string;
  @IsIn(['service', 'aceite', 'filtro', 'cubiertas', 'otro']) tipo: string;
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsInt() @Type(() => Number) km?: number;
  @IsOptional() @IsInt() @Type(() => Number) proximoKm?: number;
  @IsDateString() fecha: string;
}
