import { IsDateString, IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateChoferDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional()
  @Matches(/^\d{7,8}$/, { message: 'DNI debe tener 7 u 8 dígitos' })
  dni?: string;

  @IsOptional() @IsString() cuit?: string;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() transportistaId?: string;
}
