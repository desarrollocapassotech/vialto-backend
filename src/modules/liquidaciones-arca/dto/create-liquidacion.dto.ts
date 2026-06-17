import {
  IsString,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  ArrayMinSize,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateLiquidacionDto {
  @IsString()
  transportistaId: string;

  @IsDateString()
  periodoDesde: string;

  @IsDateString()
  periodoHasta: string;

  /** IDs de los viajes a incluir en la liquidación */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  viajeIds: string[];

  /**
   * Porcentaje de comisión a aplicar.
   * Si no se envía, se usa el comisionPct del Transportista;
   * si tampoco tiene, se usa comisionPctDefault de ArcaConfig o 0.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPct?: number;

  /**
   * Alícuota de IVA (%) a aplicar sobre el neto gravado.
   * Si no se envía, se usa ivaGastosAdmin de ArcaConfig o 21% por defecto.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  comprobanteUrl?: string;
}
