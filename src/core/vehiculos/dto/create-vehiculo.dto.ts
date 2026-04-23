import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsNotEmpty, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehiculoDto {
  @IsString() @IsNotEmpty() patente: string;

  @IsIn(['tractor', 'semirremolque', 'camion', 'utilitario', 'otro'])
  tipo: string;

  @IsOptional() @IsString() marca?: string;
  @IsOptional() @IsString() modelo?: string;
  @IsOptional() @IsInt() @Type(() => Number) anio?: number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) kmActual?: number;
  @IsOptional() @IsString() nroChasis?: string;
  @IsOptional() @IsString() poliza?: string;
  @IsOptional() @IsDateString() vencimientoPoliza?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) tara?: number;
  @IsOptional() @IsString() precinto?: string;
  @IsOptional() @IsString() transportistaId?: string;
}
