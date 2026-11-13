import {
  ArrayMaxSize,
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
import { FacturaConceptoDto } from './create-factura.dto';

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
  /** Ver `CreateFacturaDto.observaciones`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  observaciones?: string[];
  /** Ver `CreateFacturaDto.conceptos`. Sin el campo no se tocan; `[]` los quita. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FacturaConceptoDto)
  conceptos?: FacturaConceptoDto[];
  @IsOptional() @IsBoolean() facturarPorTramo?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos?: FacturaTramoDto[];
}
