import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateTransportistaDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString() idFiscal?: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
}
