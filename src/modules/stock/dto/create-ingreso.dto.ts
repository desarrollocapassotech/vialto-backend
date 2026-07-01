import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateIngresoLineaDto } from './create-ingreso-linea.dto';

export class CreateIngresoDto {
  @IsString() @IsNotEmpty() clienteId!: string;
  @IsString() @IsNotEmpty() depositoId!: string;

  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  @IsString() @IsNotEmpty() fecha!: string;

  /** URLs de las fotos adjuntas (0 a 2), ya subidas a Cloudinary. */
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2048, { each: true })
  fotosUrls!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateIngresoLineaDto)
  lineas!: CreateIngresoLineaDto[];

  @IsOptional() @IsString() observaciones?: string;

  @IsOptional() @IsString() @MaxLength(100) numeroRemitoProveedor?: string;
}
