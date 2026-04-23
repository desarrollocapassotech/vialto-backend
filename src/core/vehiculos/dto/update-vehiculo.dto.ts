import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsDateString, Min, ValidateIf } from 'class-validator';
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
  @IsOptional() @IsString() nroChasis?: string;
  @IsOptional() @IsString() poliza?: string;
  @IsOptional() @IsDateString() vencimientoPoliza?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) tara?: number;
  @IsOptional() @IsString() precinto?: string;
  /** null = flota propia; string = id del transportista (cuid). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  transportistaId?: string | null;
}
