import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Tramo de factura: siempre vinculado a un viaje de la factura. */
export class FacturaTramoDto {
  @IsString()
  @IsNotEmpty()
  viajeId: string;

  @IsString()
  @IsNotEmpty()
  detalle: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  monto: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  ivaPct: number;
}

export class FacturaTramosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FacturaTramoDto)
  tramos: FacturaTramoDto[];
}
