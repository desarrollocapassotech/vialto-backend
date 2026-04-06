import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateViajeDto {
  /** Si no se envía, el servidor asigna un correlativo (AAAA-NNNNNN). */
  @IsOptional() @IsString() numero?: string;

  @IsOptional()
  @IsIn(['pendiente', 'en_curso', 'finalizado', 'cancelado'])
  estado?: string;

  @IsString() @IsNotEmpty() clienteId: string;
  @IsOptional() @IsString() transportistaId?: string;
  /** Obligatorio junto con vehiculoId si no hay transportista externo. */
  @IsOptional() @IsString() choferId?: string | null;
  @IsOptional() @IsString() vehiculoId?: string | null;

  @IsString() @IsNotEmpty() patenteTractor: string;
  @IsString() @IsNotEmpty() patenteSemirremolque: string;
  @IsString() @IsNotEmpty() origen: string;
  @IsString() @IsNotEmpty() destino: string;
  @IsDateString() fechaCarga: string;
  @IsDateString() fechaDescarga: string;
  @IsOptional() @IsDateString() fechaSalida?: string;
  @IsOptional() @IsDateString() fechaLlegada?: string;
  @IsString() @IsNotEmpty() mercaderia: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) monto?: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioCliente?: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) documentacion?: string[];
  @IsString() @IsNotEmpty() observaciones: string;
}
