import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateFacturaDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional() @IsIn(['cliente', 'fletero']) tipo?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() viajeId?: string;
  @IsOptional() @IsNumber() @Type(() => Number) importe?: number;
  @IsOptional() @IsDateString() fechaEmision?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional()
  @IsIn(['pendiente', 'cobrada', 'vencida'])
  estado?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
}
