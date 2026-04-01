import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFacturaDto {
  @IsString() @IsNotEmpty() numero: string;
  @IsIn(['cliente', 'transportista_externo']) tipo: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() viajeId?: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsDateString() fechaEmision: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional()
  @IsIn(['pendiente', 'cobrada', 'vencida'])
  estado?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
}
