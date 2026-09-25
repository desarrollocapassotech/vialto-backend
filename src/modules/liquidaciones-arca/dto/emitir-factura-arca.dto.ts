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

  /**
   * CTG/ID visible del viaje (`numeroIdentificacionPersonalizado || '#'+numero`) —
   * solo presente cuando la línea corresponde 1:1 a un viaje vinculado. Permite
   * reconstruir el "Detalle" enriquecido del PDF de factura ARCA (ver
   * `buildDetalleFlete`/`matchViajeItem` en `factura-pdf.service.ts`).
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  producto?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cantidad?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioUnitario?: number;
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
