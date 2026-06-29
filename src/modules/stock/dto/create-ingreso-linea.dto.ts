import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';

export class CreateIngresoLineaDto {
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

  @IsString()
  @IsNotEmpty()
  lote!: string;

  /** Fecha de vencimiento en formato YYYY-MM-DD. */
  @IsString()
  @IsNotEmpty()
  fechaVencimiento!: string;
}
