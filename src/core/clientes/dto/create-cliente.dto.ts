import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClienteDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString() cuit?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() pais?: string;
}
