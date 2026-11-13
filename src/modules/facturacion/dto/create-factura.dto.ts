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

export class CreateFacturaDto {
  /** Opcional: con integracion-arca lo asigna AFIP al emitir; sin ARCA puede cargarse después, cuando se tenga el comprobante externo. */
  @IsOptional() @IsString() numero?: string;
  /**
   * true = el backend asigna el siguiente número interno (`INT-…`) e ignora `numero`. Con ARCA
   * la factura queda manual (no se emite).
   */
  @IsOptional() @IsBoolean() numeroAutomatico?: boolean;
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
  /**
   * Empresa con ARCA: factura hecha por fuera del sistema (no se emite; número obligatorio
   * y comprobante adjunto). En un borrador, pasarla a true la convierte; no se puede volver atrás.
   */
  @IsOptional() @IsBoolean() manual?: boolean;
  /**
   * Factura manual: tipo AFIP (1=A, 6=B…), punto de venta y número, obligatorios. Con estos se
   * arma `numero` (se ignora el que venga). Ver `resolverComprobanteManual`.
   */
  @IsOptional() @IsInt() @Type(() => Number) manualCbteTipo?: number;
  @IsOptional() @IsInt() @Type(() => Number) manualPtoVenta?: number;
  @IsOptional() @IsInt() @Type(() => Number) manualCbteNro?: number;
  /**
   * Observaciones de la factura: renglones sin importe que van en el PDF debajo de los viajes.
   * Se guardan sin espacios de más y sin renglones vacíos.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  observaciones?: string[];
  /** Si true, el importe se arma con tramos (+ viajes no divididos). */
  @IsOptional() @IsBoolean() facturarPorTramo?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos?: FacturaTramoDto[];
}
