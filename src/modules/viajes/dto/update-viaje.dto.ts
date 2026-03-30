import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateViajeDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional()
  @IsIn(['pendiente', 'en_transito', 'despachado', 'cerrado'])
  estado?: string;

  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsString() vehiculoId?: string;

  @IsOptional() @IsString() origen?: string;
  @IsOptional() @IsString() destino?: string;
  @IsOptional() @IsDateString() fechaSalida?: string;
  @IsOptional() @IsDateString() fechaLlegada?: string;
  @IsOptional() @IsString() mercaderia?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioCliente?: number;
  @IsOptional() @IsNumber() @Type(() => Number) precioFletero?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) documentacion?: string[];
  @IsOptional() @IsString() observaciones?: string;
}
