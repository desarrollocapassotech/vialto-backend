import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CiudadNormalizadaImportDto {
  @IsNumber()
  fila: number;

  @IsOptional()
  @IsString()
  origen?: string | null;

  @IsOptional()
  @IsString()
  destino?: string | null;
}

export class ConfirmImportDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;

  /** Ciudades normalizadas en previsualización (origen/destino por fila). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CiudadNormalizadaImportDto)
  ciudadesNormalizadas?: CiudadNormalizadaImportDto[];

  /** Filas que el usuario decidió no importar (ej. ciudad multidestino sin resolver). */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  filasExcluidas?: number[];
}
