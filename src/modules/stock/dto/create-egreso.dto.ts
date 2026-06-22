import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateEgresoLineaDto } from './create-egreso-linea.dto';

export class CreateEgresoDto {
  @IsString()
  @IsNotEmpty()
  clienteId!: string;

  @IsString()
  @IsNotEmpty()
  depositoId!: string;

  /** ISO 8601 (recomendado) o solo `YYYY-MM-DD` (medianoche Argentina). */
  @IsString()
  @IsNotEmpty()
  fecha!: string;

  /** URL del remito escaneado (PDF o imagen) tras subida a Cloudinary. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  remitoEscaneadoUrl!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateEgresoLineaDto)
  lineas!: CreateEgresoLineaDto[];

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

  @IsOptional()
  @IsString()
  observaciones?: string;
}
