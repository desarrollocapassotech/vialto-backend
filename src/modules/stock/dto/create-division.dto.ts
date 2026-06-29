import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDivisionDto {
  @IsString() @IsNotEmpty() clienteId!: string;
  @IsString() @IsNotEmpty() depositoId!: string;
  @IsString() @IsNotEmpty() productoId!: string;
  /** ProductoPresentacion.id — determina unidadesPorBulto */
  @IsString() @IsNotEmpty() presentacionId!: string;
  /** Cantidad de bultos a convertir en sueltas (mínimo 1). */
  @IsNumber() @Min(1) @Type(() => Number) bultos!: number;
  @IsString() @IsNotEmpty() fecha!: string;
  @IsOptional() @IsString() lote?: string;
  @IsOptional() @IsString() observaciones?: string;
}
