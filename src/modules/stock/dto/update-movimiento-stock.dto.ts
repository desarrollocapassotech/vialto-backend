import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMovimientoStockDto {
  @IsOptional() @IsString() productoId?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsIn(['ingreso', 'egreso', 'division']) tipo?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) cantidadPallets?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) cantidadSuelto?: number;
  @IsOptional() @IsString() remitoId?: string;
  @IsOptional() @IsString() fecha?: string;
}
