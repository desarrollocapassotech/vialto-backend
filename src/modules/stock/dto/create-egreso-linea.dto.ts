import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEgresoLineaDto {
  @IsString()
  @IsNotEmpty()
  productoId!: string;

  /** ID de ProductoPresentacion (no de Presentacion). */
  @IsString()
  @IsNotEmpty()
  presentacionId!: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  bultos!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  sueltas!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lote?: string | null;

  /** Fecha de vencimiento del lote (ISO). El backend la valida contra el ingreso si no se envía. */
  @IsOptional()
  @IsString()
  fechaVencimiento?: string;
}
