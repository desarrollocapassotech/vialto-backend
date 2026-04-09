import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFacturaDto {
  @IsString() @IsNotEmpty() numero: string;
  @IsIn(['cliente', 'transportista_externo']) tipo: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) viajeIds?: string[];
  @IsDateString() fechaEmision: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
}
