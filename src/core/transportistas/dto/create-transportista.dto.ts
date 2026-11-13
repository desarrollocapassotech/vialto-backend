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

export class CreateTransportistaDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre: string;

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

  /** Tipo de proveedor; sin valor = transportista (compatibilidad con las altas de siempre). */
  @IsOptional() @IsIn(PROVEEDOR_TIPOS) tipo?: ProveedorTipo;

  /** Obligatorio con tipo "otro": nombre del tipo (ej. "Combustible"). Se ignora en los demás. */
  @IsOptional() @Transform(trimString) @IsString() @MaxLength(60) categoria?: string;

  @IsOptional() @IsBoolean() activo?: boolean;

  /** El usuario confirmó explícitamente que quiere guardar sin ID Fiscal y/o país. */
  @IsOptional() @IsBoolean() confirmarSinDatosFiscales?: boolean;
}
