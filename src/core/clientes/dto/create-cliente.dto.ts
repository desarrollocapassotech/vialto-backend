import { IsEmail, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClienteDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString() idFiscal?: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() pais?: string;
}
