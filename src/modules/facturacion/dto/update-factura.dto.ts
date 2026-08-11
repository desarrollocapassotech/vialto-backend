import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FacturaTramoDto } from './factura-tramo.dto';

export class UpdateFacturaDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional() @IsIn(['cliente', 'transportista_externo']) tipo?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) viajeIds?: string[];
  @IsOptional() @IsDateString() fechaEmision?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
  @IsOptional() @IsNumber() @Type(() => Number) ivaPct?: number;
  @IsOptional() @IsString() @MaxLength(2048) comprobanteUrl?: string;
  @IsOptional() @IsBoolean() facturarPorTramo?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos?: FacturaTramoDto[];
}
