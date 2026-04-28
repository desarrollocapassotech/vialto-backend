import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEstadoViaje, VIAJE_ESTADOS } from '../viaje-estados';

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
  /** Obligatorio si no hay transportista externo. */
  @IsOptional() @IsString() choferId?: string | null;
  /** IDs de vehículos del maestro (orden = orden del array). Requerido al menos 1 sin transportista externo. */
  @IsOptional() @IsArray() @IsString({ each: true }) vehiculoIds?: string[];
  @IsString() @IsNotEmpty() origen: string;
  @IsString() @IsNotEmpty() destino: string;
  @IsDateString() fechaCarga: string;
  @IsDateString() fechaDescarga: string;
  @IsOptional() @IsString() detalleCarga?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsNumber() @Min(0.01) @Type(() => Number) monto: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(['ARS', 'USD']) monedaMonto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(['ARS', 'USD']) monedaPrecioTransportistaExterno?: string;
  @IsOptional() @IsString() observaciones?: string;
}
