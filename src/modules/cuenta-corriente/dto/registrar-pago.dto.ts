import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class RegistrarPagoDto {
  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsNumber()
  @Type(() => Number)
  importe: number;

  @IsDateString()
  fecha: string;

  @IsOptional()
  @IsString()
  formaPago?: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  concepto?: string;
}
