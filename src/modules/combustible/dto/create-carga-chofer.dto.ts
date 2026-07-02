import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/** DTO para que el chofer registre una carga desde vialto-combustible. Recibe patente en lugar de vehiculoId. */
export class CreateCargaChoferDto {
  @IsString() @IsNotEmpty() patente: string;
  @IsString() @IsNotEmpty() estacion: string;
  @IsNumber() @Type(() => Number) litros: number;
  @IsNumber() @Type(() => Number) importe: number;
  @IsNumber() @Type(() => Number) km: number;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsDateString() fecha?: string;
}
