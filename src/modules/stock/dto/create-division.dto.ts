import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDivisionDto {
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsString()
  @IsNotEmpty()
  depositoId: string;

  /** Pallets que se restan (origen). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  palletsOrigen?: number;

  /** Suelto que se resta (origen). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  sueltoOrigen?: number;

  /** Pallets que se suman (destino). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  palletsDestino?: number;

  /** Suelto que se suma (destino). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  sueltoDestino?: number;

  @IsString()
  @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
