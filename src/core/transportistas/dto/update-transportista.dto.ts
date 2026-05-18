import { IsDateString, IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateTransportistaDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() pais?: string;

  @IsOptional() @IsString() paut?: string;
  @IsOptional() @IsString() permisoInternacional?: string;
  @IsOptional() @IsDateString() fechaVencimientoPermiso?: string;
  @IsOptional() @IsString() domicilio?: string;
  @IsOptional() @IsString() bandera?: string;
}
