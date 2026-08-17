import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateClienteDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre?: string;

  /** Recomendado, no obligatorio — ver `confirmarSinDatosFiscales`. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  idFiscal?: string;

  /** Recomendado, no obligatorio — ver `confirmarSinDatosFiscales`. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  pais?: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) condicionIva?: number;
  @IsOptional() @IsString() condicionTributaria?: string;

  /** El usuario confirmó explícitamente que quiere guardar sin ID Fiscal y/o país. */
  @IsOptional() @IsBoolean() confirmarSinDatosFiscales?: boolean;
}
