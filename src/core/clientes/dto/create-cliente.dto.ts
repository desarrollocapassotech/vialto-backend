import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateClienteDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El ID Fiscal es obligatorio' })
  idFiscal: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El país es obligatorio' })
  pais: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
}
