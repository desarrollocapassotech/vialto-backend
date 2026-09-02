import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

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
}
