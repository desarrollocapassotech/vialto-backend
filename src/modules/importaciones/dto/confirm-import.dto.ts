import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
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

export class IdFiscalDuplicadoDecisionDto {
  @IsNumber()
  fila: number;

  @IsIn(['ignorar', 'actualizar'])
  accion: 'ignorar' | 'actualizar';
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

  /** El usuario confirmó que quiere importar igual filas con campos `warnIfEmpty` vacíos (ej. cliente sin CUIT/país). */
  @IsOptional()
  @IsBoolean()
  confirmarCamposFaltantes?: boolean;

  /** Solo viajes: el usuario confirmó que varios viajes nuevos comparten número de factura (se reutiliza y suma en vez de duplicar). */
  @IsOptional()
  @IsBoolean()
  confirmarFacturasDuplicadas?: boolean;

  /** Solo clientes: decisión por fila ("ignorar" o "actualizar") para cada conflicto de ID Fiscal detectado en el preview (ver `PreviewResult.advertenciasIdFiscalDuplicado`). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdFiscalDuplicadoDecisionDto)
  decisionesIdFiscalDuplicado?: IdFiscalDuplicadoDecisionDto[];
}
