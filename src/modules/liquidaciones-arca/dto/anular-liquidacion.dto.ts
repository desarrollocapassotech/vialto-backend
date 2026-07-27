import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AnularLiquidacionDto {
  /** Motivo de anulación (texto libre obligatorio). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'El motivo de anulación es obligatorio.' })
  @MaxLength(2000, { message: 'El motivo no puede superar 2000 caracteres.' })
  motivo: string;
}
