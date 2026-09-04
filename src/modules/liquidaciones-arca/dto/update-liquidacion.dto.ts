import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LiquidacionConceptoLineaDto } from './create-liquidacion.dto';

export class UpdateLiquidacionDto {
  @IsOptional()
  @IsDateString()
  periodoDesde?: string;

  @IsOptional()
  @IsDateString()
  periodoHasta?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  comisionPct?: number;

  /**
   * Alícuota de IVA (%) sobre flete/comisión/gastos admin.
   * Si se omite al recalcular comisión, se conserva la alícuota implícita
   * de la liquidación o el default de configuración.
   */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  ivaPct?: number;

  /** Reemplaza por completo las líneas de conceptos configurables. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LiquidacionConceptoLineaDto)
  conceptosLineas?: LiquidacionConceptoLineaDto[];

  /**
   * Reemplaza por completo el conjunto de viajes incluidos en la liquidación.
   * Solo se acepta con la liquidación en estado "borrador".
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  viajeIds?: string[];

  /** URL Cloudinary del comprobante; `null` limpia el adjunto. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  comprobanteUrl?: string | null;
}
