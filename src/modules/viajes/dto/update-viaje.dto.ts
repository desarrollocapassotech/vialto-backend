import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEstadoViaje, VIAJE_ESTADOS } from '../viaje-estados';
import { OtroGastoDto, PagoTransportistaDto } from './create-viaje.dto';
import { ViajeProductoItemDto } from './viaje-producto-item.dto';
import { ViajeDestinoItemDto } from './viaje-destino-item.dto';

export { PagoTransportistaDto };

export class UpdateViajeDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    return normalizarEstadoViaje(value);
  })
  @IsIn(VIAJE_ESTADOS as unknown as [string, ...string[]])
  estado?: string;

  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() transportistaId?: string;
  /** Si es false, el contratante no realiza el flete y `transportistaEfectivoId` es obligatorio. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean()
  contratanteRealizaFlete?: boolean;
  /** Transportista que efectivamente realiza el flete (cuando difiere del contratante). */
  @IsOptional() @IsString() transportistaEfectivoId?: string | null;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) vehiculoIds?: string[];
  @IsOptional() @IsString() origen?: string;
  /** Legacy: un solo destino (reemplaza toda la lista con una parada). */
  @IsOptional() @IsString() destino?: string;
  /** Reemplaza todos los destinos del viaje (orden del array = orden de la ruta). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ViajeDestinoItemDto)
  destinos?: ViajeDestinoItemDto[];
  @IsOptional() @IsDateString() fechaCarga?: string;
  @IsOptional() @IsDateString() fechaDescarga?: string;
  /** Reemplaza todos los productos del viaje (vacío = sin productos). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ViajeProductoItemDto) productoItems?: ViajeProductoItemDto[];
  @IsOptional() @IsString() detalleCarga?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) monto?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaMonto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) precioTransportistaExterno?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaPrecioTransportistaExterno?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) gananciaBrutaManual?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaGananciaBrutaManual?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OtroGastoDto) otrosGastos?: OtroGastoDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PagoTransportistaDto) pagosTransportista?: PagoTransportistaDto[];
}
