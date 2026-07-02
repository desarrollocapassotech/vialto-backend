import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

/** Acepta `cuit` o alias `CUIT` del front y normaliza trim. */
function normalizeCuit({ obj, value }: { obj: object; value: unknown }) {
  const raw =
    value ??
    (obj as Record<string, unknown>).CUIT ??
    (obj as Record<string, unknown>).cuitCuil;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export class CreateChoferDto {
  @IsString() @IsNotEmpty() nombre: string;

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
  @IsOptional() @IsString() transportistaId?: string;

  /** PIN de login para la app vialto-combustible (4 dígitos). Se hashea antes de guardarse. */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'PIN debe tener 4 dígitos' })
  pin?: string;
}
