import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateIngresoDto {
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsString()
  @IsNotEmpty()
  depositoId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidadPallets?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidadSuelto?: number;

  @IsString()
  @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
