import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateVehiculoDto {
  @IsOptional() @IsString() patente?: string;

  @IsOptional()
  @IsIn(['tractor', 'semirremolque', 'camion', 'utilitario', 'otro'])
  tipo?: string;

  @IsOptional() @IsString() marca?: string;
  @IsOptional() @IsString() modelo?: string;
  @IsOptional() @IsInt() @Type(() => Number) anio?: number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) kmActual?: number;
  @IsOptional() @IsString() transportistaId?: string;
}
