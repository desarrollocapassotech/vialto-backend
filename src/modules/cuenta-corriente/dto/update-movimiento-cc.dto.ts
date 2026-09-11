import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMovimientoCcDto {
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() proveedorId?: string;
  @IsOptional() @IsIn(['cargo', 'pago']) tipo?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) importe?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsString() numeroComprobante?: string;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsString() referencia?: string;
}
