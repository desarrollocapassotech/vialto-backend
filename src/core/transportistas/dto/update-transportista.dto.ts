import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateTransportistaDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
}
