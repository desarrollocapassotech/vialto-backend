import { IsDateString, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Datos del comprobante de un movimiento editables desde Cuenta corriente. Cada campo es
 * opcional: `undefined` no lo toca, `null` lo borra.
 */
export class UpdateComprobanteCcDto {
  /** N° de comprobante (liquidación sin ARCA o venta/compra manual). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  numeroComprobante?: string | null;

  /** Vencimiento `YYYY-MM-DD` (compra de liquidación —con o sin ARCA— o venta/compra manual). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  fechaVencimiento?: string | null;

  /**
   * Archivo del comprobante (URL de Cloudinary, subido antes vía upload-comprobante). Solo
   * factura o liquidación sin ARCA: se guarda en su `comprobanteUrl`.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  comprobanteUrl?: string | null;
}
