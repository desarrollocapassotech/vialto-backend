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
  /** Obligatorio junto con vehiculoId si no hay transportista externo. */
  @IsOptional() @IsString() choferId?: string | null;
  @IsOptional() @IsString() vehiculoId?: string | null;

  @IsOptional() @IsString() patenteTractor?: string;
  @IsOptional() @IsString() patenteSemirremolque?: string;
  @IsString() @IsNotEmpty() origen: string;
  @IsString() @IsNotEmpty() destino: string;
  @IsOptional() @IsDateString() fechaCarga?: string;
  @IsOptional() @IsDateString() fechaDescarga?: string;
  @IsOptional() @IsString() mercaderia?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsNumber() @Min(0.01) @Type(() => Number) monto: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) documentacion?: string[];
  @IsOptional() @IsString() observaciones?: string;
}
