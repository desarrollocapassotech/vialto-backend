import { IsIn, IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateTransportistaDto {
  @IsString() @IsNotEmpty() nombre: string;

  @IsOptional() @IsString()
  @Matches(/^\d{10,11}$/, { message: 'CUIT debe tener 10 u 11 dígitos' })
  cuit?: string;

  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsIn(['externo', 'propio']) tipo?: string;
}
