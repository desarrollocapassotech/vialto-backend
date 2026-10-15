import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Número de comprobante de un movimiento editable (liquidación sin ARCA o venta/compra manual). `null` lo borra. */
export class UpdateComprobanteCcDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  numeroComprobante?: string | null;
}
