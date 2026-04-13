import { IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
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
  /** null = flota propia; string = id del transportista (cuid). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  transportistaId?: string | null;
}
