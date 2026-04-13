import { IsDateString, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateChoferDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() dni?: string;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  /** null = flota propia; string = id del transportista (cuid). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  transportistaId?: string | null;
}
