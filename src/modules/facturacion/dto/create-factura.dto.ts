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

export class CreateFacturaDto {
  /** Opcional: con integracion-arca lo asigna AFIP al emitir; sin ARCA puede cargarse después, cuando se tenga el comprobante externo. */
  @IsOptional() @IsString() numero?: string;
  /** Siempre "cliente" — el pago a transportistas externos se gestiona en Liquidaciones, no como Factura. */
  @IsIn(['cliente']) tipo: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) viajeIds?: string[];
  @IsDateString() fechaEmision: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsNumber() @Type(() => Number) diferencia?: number;
  @IsOptional() @IsNumber() @Type(() => Number) ivaPct?: number;
  @IsOptional() @IsString() @MaxLength(2048) comprobanteUrl?: string;
  /** Si true, el importe se arma con tramos (+ viajes no divididos). */
  @IsOptional() @IsBoolean() facturarPorTramo?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos?: FacturaTramoDto[];
}
