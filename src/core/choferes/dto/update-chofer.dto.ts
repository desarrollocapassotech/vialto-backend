import { IsDateString, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class UpdateChoferDto {
  @IsOptional() @IsString() nombre?: string;

  @IsOptional()
  @Matches(/^\d{7,8}$/, { message: 'DNI debe tener 7 u 8 dígitos' })
  dni?: string;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  /** null = flota propia; string = id del transportista (cuid). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  transportistaId?: string | null;
}
