import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEgresoDto {
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @IsString()
  @IsNotEmpty()
  presentacionId: string;

  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  cantidad: number;

  @IsString()
  @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  /** URL del remito escaneado (p. ej. tras subida a Cloudinary). Opcional. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  remitoEscaneadoUrl?: string;
}
