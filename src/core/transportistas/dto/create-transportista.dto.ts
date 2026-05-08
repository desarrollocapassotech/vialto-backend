import { IsDateString, IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateTransportistaDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;

  @IsOptional() @IsString() paut?: string;
  @IsOptional() @IsString() permisoInternacional?: string;
  @IsOptional() @IsDateString() fechaVencimientoPermiso?: string;
  @IsOptional() @IsString() domicilio?: string;
  @IsOptional() @IsString() bandera?: string;
}
