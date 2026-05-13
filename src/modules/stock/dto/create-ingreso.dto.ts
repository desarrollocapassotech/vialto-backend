import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class CreateIngresoDto {
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

  @IsDateString()
  fecha: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
