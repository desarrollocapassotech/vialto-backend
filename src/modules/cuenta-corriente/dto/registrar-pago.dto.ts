import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class RegistrarPagoDto {
  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsString()
  proveedorId?: string;

  @IsNumber()
  @Type(() => Number)
  importe: number;

  @IsOptional()
  @IsIn(['ARS', 'USD'])
  moneda?: string;

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
