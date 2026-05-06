import { IsEmail, IsString, IsOptional } from 'class-validator';

export class UpdateClienteDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() pais?: string;
}
