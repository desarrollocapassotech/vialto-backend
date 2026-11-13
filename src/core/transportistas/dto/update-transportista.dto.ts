import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PROVEEDOR_TIPOS, type ProveedorTipo } from '../../../shared/util/proveedor-tipo';

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

  /** Tipo de proveedor. No se puede cambiar si el proveedor ya se usó como ese tipo (viajes, OT…). */
  @IsOptional() @IsIn(PROVEEDOR_TIPOS) tipo?: ProveedorTipo;

  /** Con tipo "otro": nombre del tipo (ej. "Combustible"). Sin el campo no se toca. */
  @IsOptional() @Transform(trimString) @IsString() @MaxLength(60) categoria?: string;

  /** false = desactivado (no se ofrece en los selectores, conserva el historial). */
  @IsOptional() @IsBoolean() activo?: boolean;

  /** El usuario confirmó explícitamente que quiere guardar sin ID Fiscal y/o país. */
  @IsOptional() @IsBoolean() confirmarSinDatosFiscales?: boolean;
}
