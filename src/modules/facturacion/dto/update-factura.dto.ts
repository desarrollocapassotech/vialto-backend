import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
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
  /** Siempre "cliente" — el pago a transportistas externos se gestiona en Liquidaciones, no como Factura. */
  @IsOptional() @IsIn(['cliente']) tipo?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) viajeIds?: string[];
  @IsOptional() @IsDateString() fechaEmision?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
  @IsOptional() @IsNumber() @Type(() => Number) ivaPct?: number;
  @IsOptional() @IsString() @MaxLength(2048) comprobanteUrl?: string;
  /** Ver `CreateFacturaDto.manual`: solo pasa un borrador a manual (true); false se ignora. */
  @IsOptional() @IsBoolean() manual?: boolean;
  /** Ver `CreateFacturaDto.manualCbteTipo`. */
  @IsOptional() @IsInt() @Type(() => Number) manualCbteTipo?: number;
  @IsOptional() @IsInt() @Type(() => Number) manualPtoVenta?: number;
  @IsOptional() @IsInt() @Type(() => Number) manualCbteNro?: number;
  @IsOptional() @IsBoolean() facturarPorTramo?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos?: FacturaTramoDto[];
}
