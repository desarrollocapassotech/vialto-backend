import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEgresoDto {
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

  /** URL del remito escaneado (p. ej. tras subida a Cloudinary). Opcional. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  remitoEscaneadoUrl?: string;
}
