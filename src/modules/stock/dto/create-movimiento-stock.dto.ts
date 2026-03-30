import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoStockDto {
  @IsString() @IsNotEmpty() productoId: string;
  @IsString() @IsNotEmpty() clienteId: string;
  @IsIn(['ingreso', 'egreso', 'division']) tipo: string;
  @IsNumber() @Type(() => Number) cantidad: number;
  @IsOptional() @IsNumber() @Type(() => Number) pesoKg?: number;
  @IsOptional() @IsString() remito?: string;
  @IsDateString() fecha: string;
}
