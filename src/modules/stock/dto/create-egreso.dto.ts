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
  cantidad1?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidad2?: number;

  @IsString()
  @IsNotEmpty()
  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  fecha: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lote?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  entregadoPor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinatario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  destinoFinal?: string;

  /** URL del remito (PDF o imagen) tras subida a Cloudinary. Obligatorio en egresos. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  remitoEscaneadoUrl: string;
}
