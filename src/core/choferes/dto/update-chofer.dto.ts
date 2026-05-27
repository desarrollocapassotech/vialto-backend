import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

function normalizeCuit({ obj, value }: { obj: object; value: unknown }) {
  const raw =
    value ??
    (obj as Record<string, unknown>).CUIT ??
    (obj as Record<string, unknown>).cuitCuil;
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export class UpdateChoferDto {
  @IsOptional() @IsString() nombre?: string;

  @IsOptional()
  @Matches(/^\d{7,8}$/, { message: 'DNI debe tener 7 u 8 dígitos' })
  dni?: string;

  @IsOptional()
  @Transform(normalizeCuit)
  @IsString()
  cuit?: string | null;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  /** null = flota propia; string = id del transportista (cuid). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  transportistaId?: string | null;
}
