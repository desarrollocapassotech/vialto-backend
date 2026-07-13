import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateIngresoLineaDto {
  @IsString()
  @IsNotEmpty()
  productoId!: string;

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
  @IsBoolean()
  sinLote?: boolean;

  /** Obligatorio salvo que sinLote sea true (el servidor asignará un lote interno único). */
  @ValidateIf((o) => !o.sinLote)
  @IsString()
  @IsNotEmpty()
  lote?: string;

  /** Fecha de vencimiento en formato YYYY-MM-DD. */
  @IsString()
  @IsNotEmpty()
  fechaVencimiento!: string;
}
