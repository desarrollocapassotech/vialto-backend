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
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LiquidacionConceptoLineaDto {
  @IsString()
  conceptoLiquidacionId: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  monto: number;

  @IsOptional()
  @IsString()
  @IsIn(['GENERAL', 'VIAJE_PUNTUAL', 'TODOS_LOS_VIAJES'])
  modoAplicacion?: string;

  @IsOptional()
  @IsString()
  viajeId?: string;
}

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
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPct?: number;

  /**
   * Alícuota de IVA (%) a aplicar sobre flete/comisión/gastos admin.
   * Si no se envía, se usa ivaGastosAdmin de ArcaConfig o 21% por defecto.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number;

  /**
   * Líneas opcionales de conceptos configurables del tenant
   * (monto manual, una vez por liquidación).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LiquidacionConceptoLineaDto)
  conceptosLineas?: LiquidacionConceptoLineaDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  comprobanteUrl?: string;
}
