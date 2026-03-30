import { IsDateString, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePagoDto {
  @IsString() @IsNotEmpty() facturaId: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() formaPago?: string;
}
