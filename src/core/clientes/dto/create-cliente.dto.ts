import { IsEmail, IsInt, IsString, IsNotEmpty, IsOptional, Min, Max } from 'class-validator';

export class CreateClienteDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString() idFiscal?: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() pais?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) condicionIva?: number;
  @IsOptional() @IsString() condicionTributaria?: string;
}
