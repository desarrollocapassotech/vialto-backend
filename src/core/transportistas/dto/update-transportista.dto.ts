import { IsDateString, IsEmail, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateTransportistaDto {
  @IsOptional() @IsString() nombre?: string;

  @IsOptional() @IsString() pais?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() domicilio?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) condicionIva?: number;
  @IsOptional() @IsString() condicionTributaria?: string;

  @IsOptional() @IsString() paut?: string;
  @IsOptional() @IsString() permisoInternacional?: string;
  @IsOptional() @IsDateString() fechaVencimientoPermiso?: string;
}
