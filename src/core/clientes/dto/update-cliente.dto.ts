import { IsString, IsOptional, Matches } from 'class-validator';

export class UpdateClienteDto {
  @IsOptional() @IsString() nombre?: string;

  @IsOptional() @IsString()
  @Matches(/^\d{10,11}$/, { message: 'CUIT debe tener 10 u 11 dígitos' })
  cuit?: string;

  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
}
