import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FacturaLineaDto {
  @IsString()
  @MaxLength(200)
  descripcion: string;

  /** Importe neto (sin IVA) de la línea. */
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  importe: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  ivaPct?: number;
}

export class EmitirFacturaArcaDto {
  /** Líneas del comprobante. Si se omite, se derivan de la factura y sus viajes. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FacturaLineaDto)
  lineas?: FacturaLineaDto[];
}
