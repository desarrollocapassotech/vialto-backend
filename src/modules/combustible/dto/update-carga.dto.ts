import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCargaDto {
  @IsOptional() @IsString() vehiculoId?: string;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsString() estacion?: string;
  @IsOptional() @IsNumber() @Type(() => Number) litros?: number;
  @IsOptional() @IsNumber() @Type(() => Number) importe?: number;
  @IsOptional() @IsNumber() @Type(() => Number) km?: number;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsDateString() fecha?: string;
}
