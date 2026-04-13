import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEstadoViaje, VIAJE_ESTADOS } from '../viaje-estados';

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
  @IsOptional() @IsString() mercaderia?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) monto?: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) documentacion?: string[];
  @IsOptional() @IsString() observaciones?: string;
}
