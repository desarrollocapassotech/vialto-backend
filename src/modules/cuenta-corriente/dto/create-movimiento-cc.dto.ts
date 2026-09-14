import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoCcDto {
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() proveedorId?: string;
  @IsIn(['cargo', 'pago']) tipo: string;
  @IsOptional() @IsString() concepto?: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsString() numeroComprobante?: string;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsString() referencia?: string;
}
