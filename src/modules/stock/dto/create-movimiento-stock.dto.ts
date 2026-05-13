import { IsIn, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoStockDto {
  @IsString() @IsNotEmpty() productoId: string;
  @IsString() @IsNotEmpty() clienteId: string;
  @IsIn(['ingreso', 'egreso', 'division']) tipo: string;
  @IsNumber() @Type(() => Number) cantidad: number;
  @IsOptional() @IsString() remitoId?: string;
  @IsString() @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;
}
