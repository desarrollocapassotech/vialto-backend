import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovimientoCcDto {
  @IsString() @IsNotEmpty() clienteId: string;
  @IsIn(['cargo', 'pago', 'nota_credito']) tipo: string;
  @IsString() @IsNotEmpty() concepto: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsNumber() @Type(() => Number) saldoPost: number;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() referencia?: string;
}
