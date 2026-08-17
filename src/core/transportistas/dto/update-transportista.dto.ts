import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
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

export class UpdateTransportistaDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre?: string;

  /** Recomendado, no obligatorio — ver `confirmarSinDatosFiscales`. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  pais?: string;

  /** Recomendado, no obligatorio — ver `confirmarSinDatosFiscales`. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  idFiscal?: string;

  @IsOptional() @IsEmail({}, { message: 'Email inválido' }) email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() domicilio?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) condicionIva?: number;
  @IsOptional() @IsString() condicionTributaria?: string;

  @IsOptional() @IsString() paut?: string;
  @IsOptional() @IsString() permisoInternacional?: string;
  @IsOptional() @IsDateString() fechaVencimientoPermiso?: string;

  /** El usuario confirmó explícitamente que quiere guardar sin ID Fiscal y/o país. */
  @IsOptional() @IsBoolean() confirmarSinDatosFiscales?: boolean;
}
