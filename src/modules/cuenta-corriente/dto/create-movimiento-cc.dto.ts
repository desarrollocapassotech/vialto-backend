import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoCcDto {
  @IsString() @IsNotEmpty() clienteId: string;
  @IsIn(['cargo', 'pago']) tipo: string;
  @IsOptional() @IsString() concepto?: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsString() referencia?: string;
}
