import { IsDateString, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCargaDto {
  @IsString() @IsNotEmpty() vehiculoId: string;
  @IsOptional() @IsString() choferId?: string;
  @IsString() @IsNotEmpty() estacion: string;
  @IsNumber() @Type(() => Number) litros: number;
  @IsNumber() @Type(() => Number) importe: number;
  @IsNumber() @Type(() => Number) km: number;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsDateString() fecha?: string;
}
