import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMovimientoStockDto {
  @IsOptional() @IsString() productoId?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsIn(['ingreso', 'egreso', 'division']) tipo?: string;
  @IsOptional() @IsNumber() @Type(() => Number) cantidad?: number;
  @IsOptional() @IsNumber() @Type(() => Number) pesoKg?: number;
  @IsOptional() @IsString() remito?: string;
  @IsOptional() @IsDateString() fecha?: string;
}
