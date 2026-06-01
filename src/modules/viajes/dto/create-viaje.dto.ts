import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEstadoViaje, VIAJE_ESTADOS } from '../viaje-estados';
import { ViajeProductoItemDto } from './viaje-producto-item.dto';

export class OtroGastoDto {
  @IsString() @IsNotEmpty() descripcion: string;
  @IsNumber() @Min(0) @Type(() => Number) monto: number;
  @IsIn(['ARS', 'USD']) moneda: string;
  @IsOptional() @IsDateString() fecha?: string;
}

export class PagoTransportistaDto {
  @IsNumber() @Min(0) @Type(() => Number) monto: number;
  @IsIn(['ARS', 'USD']) moneda: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class CreateViajeDto {
  /** Si no se envía, el servidor asigna un correlativo (AAAA-NNNNNN). */
  @IsOptional() @IsString() numero?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizarEstadoViaje(value) : value,
  )
  @IsIn(VIAJE_ESTADOS as unknown as [string, ...string[]])
  estado: string;

  @IsString() @IsNotEmpty() clienteId: string;
  @IsOptional() @IsString() transportistaId?: string;
  /** Transportista que efectivamente realiza el flete (cuando difiere del contratante). */
  @IsOptional() @IsString() transportistaEfectivoId?: string | null;
  /** Obligatorio si no hay transportista externo. */
  @IsOptional() @IsString() choferId?: string | null;
  /** IDs de vehículos del maestro (orden = orden del array). Requerido al menos 1 sin transportista externo. */
  @IsOptional() @IsArray() @IsString({ each: true }) vehiculoIds?: string[];
  @IsString() @IsNotEmpty() origen: string;
  @IsString() @IsNotEmpty() destino: string;
  @IsDateString() fechaCarga: string;
  @IsDateString() fechaDescarga: string;
  /** Productos a transportar (orden = orden del array). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ViajeProductoItemDto) productoItems?: ViajeProductoItemDto[];
  @IsOptional() @IsString() detalleCarga?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsNumber() @Min(0.01) @Type(() => Number) monto: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(['ARS', 'USD']) monedaMonto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(['ARS', 'USD']) monedaPrecioTransportistaExterno?: string;
  /** Solo si monedaMonto ≠ monedaPrecioTransportistaExterno. */
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) gananciaBrutaManual?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaGananciaBrutaManual?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OtroGastoDto) otrosGastos?: OtroGastoDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PagoTransportistaDto) pagosTransportista?: PagoTransportistaDto[];
}
