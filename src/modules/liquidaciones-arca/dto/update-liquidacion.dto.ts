import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

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
   * Alícuota de IVA (%) sobre el neto gravado.
   * Si se omite al recalcular comisión, se conserva la alícuota implícita
   * de la liquidación o el default de configuración.
   */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  ivaPct?: number;

  /** URL Cloudinary del comprobante; `null` limpia el adjunto. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  comprobanteUrl?: string | null;
}
