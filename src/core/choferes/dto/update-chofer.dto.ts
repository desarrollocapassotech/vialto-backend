import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

/**
 * En PATCH: si el body trae `cuit` (aunque sea null o ""), no usar alias `CUIT`/`cuitCuil`
 * porque `null ?? CUIT` reinyectaba el valor viejo y no permitía borrar el campo.
 */
function normalizeCuitUpdate({ obj, value }: { obj: object; value: unknown }) {
  const o = obj as Record<string, unknown>;
  let raw: unknown;
  if (Object.prototype.hasOwnProperty.call(obj, 'cuit')) {
    raw = value;
  } else if (Object.prototype.hasOwnProperty.call(obj, 'CUIT')) {
    raw = o.CUIT;
  } else if (Object.prototype.hasOwnProperty.call(obj, 'cuitCuil')) {
    raw = o.cuitCuil;
  } else {
    return undefined;
  }
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export class UpdateChoferDto {
  @IsOptional() @IsString() nombre?: string;

  @IsOptional()
  @Matches(/^\d{7,8}$/, { message: 'DNI debe tener 7 u 8 dígitos' })
  dni?: string;

  @IsOptional()
  @Transform(normalizeCuitUpdate)
  @ValidateIf((_, v) => v !== null)
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
