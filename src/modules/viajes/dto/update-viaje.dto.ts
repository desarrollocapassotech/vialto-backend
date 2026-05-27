import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEstadoViaje, VIAJE_ESTADOS } from '../viaje-estados';
import { OtroGastoDto, PagoTransportistaDto } from './create-viaje.dto';
import { ViajeProductoItemDto } from './viaje-producto-item.dto';

export { PagoTransportistaDto };

export class UpdateViajeDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    return normalizarEstadoViaje(value);
  })
  @IsIn(VIAJE_ESTADOS as unknown as [string, ...string[]])
  estado?: string;

  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) vehiculoIds?: string[];
  @IsOptional() @IsString() origen?: string;
  @IsOptional() @IsString() destino?: string;
  @IsOptional() @IsDateString() fechaCarga?: string;
  @IsOptional() @IsDateString() fechaDescarga?: string;
  /** Reemplaza todos los productos del viaje (vacío = sin productos). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ViajeProductoItemDto) productoItems?: ViajeProductoItemDto[];
  @IsOptional() @IsString() detalleCarga?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) monto?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaMonto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaPrecioTransportistaExterno?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) gananciaBrutaManual?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaGananciaBrutaManual?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OtroGastoDto) otrosGastos?: OtroGastoDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PagoTransportistaDto) pagosTransportista?: PagoTransportistaDto[];
}
