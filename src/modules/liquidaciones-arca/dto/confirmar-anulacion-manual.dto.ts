import { IsDateString, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ConfirmarAnulacionManualDto {
  /** Motivo de anulación (texto libre obligatorio). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'El motivo de anulación es obligatorio.' })
  @MaxLength(2000, { message: 'El motivo no puede superar 2000 caracteres.' })
  motivo: string;

  /** URL Cloudinary del comprobante pre-impreso (subido antes vía upload-comprobante). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'El comprobante de anulación es obligatorio.' })
  comprobanteUrl: string;

  /**
   * Comprobante pre-impreso (CVLP 060 con importes en negativo) para el Libro IVA Compras:
   * punto de venta, número y fecha. Se guardan en `anulacionPtoVenta/CbteNro/Fecha`.
   */
  @IsInt({ message: 'Indicá el punto de venta del comprobante de anulación.' })
  @Min(1, { message: 'Indicá el punto de venta del comprobante de anulación.' })
  @Type(() => Number)
  ptoVenta: number;

  @IsInt({ message: 'Indicá el número del comprobante de anulación.' })
  @Min(1, { message: 'Indicá el número del comprobante de anulación.' })
  @Type(() => Number)
  cbteNro: number;

  @IsDateString({}, { message: 'Indicá la fecha del comprobante de anulación.' })
  fecha: string;
}
