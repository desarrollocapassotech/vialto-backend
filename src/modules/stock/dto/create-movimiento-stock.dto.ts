import { IsIn, IsNumber, IsOptional, IsString, IsNotEmpty, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoStockDto {
  @IsString() @IsNotEmpty() productoId: string;
  @IsString() @IsNotEmpty() clienteId: string;
  @IsString() @IsNotEmpty() depositoId: string;
  @IsIn(['ingreso', 'egreso', 'division']) tipo: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) cantidadPallets?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) cantidadSuelto?: number;
  @IsOptional() @IsString() remitoId?: string;
  @IsString() @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;
}
