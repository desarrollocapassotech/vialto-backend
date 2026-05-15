import {
  IsString,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  ArrayMinSize,
  Min,
  Max,
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
   * si tampoco tiene, se usa comisionPctDefault de ArcaConfig.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPct?: number;
}
