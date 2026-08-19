import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizarEtapaViaje, VIAJE_ETAPAS } from '../viaje-estados';
import { normalizeOptionalId, OtroGastoDto, PagoTransportistaDto } from './create-viaje.dto';
import { ViajeProductoItemDto } from './viaje-producto-item.dto';
import { ViajeDestinoItemDto } from './viaje-destino-item.dto';

export { PagoTransportistaDto };

export class UpdateViajeDto {
  @IsOptional() @IsString() numero?: string;
  /** ID propio del cliente para identificar el viaje (ej. CTG). Reemplaza a `numero` en toda vista/documento humano cuando está cargado. */
  @IsOptional() @IsString() numeroIdentificacionPersonalizado?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    return normalizarEtapaViaje(value);
  })
  @IsIn(VIAJE_ETAPAS as unknown as [string, ...string[]])
  etapa?: string;

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
  @IsOptional()
  @Transform(normalizeOptionalId)
  @IsString()
  choferId?: string | null;
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
  @IsOptional()
  @IsNumber({}, { message: 'El monto a facturar debe ser un número válido.' })
  @Type(() => Number)
  monto?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaMonto?: string;
  @IsOptional()
  @IsNumber({}, { message: 'El precio del transporte debe ser un número válido.' })
  @Type(() => Number)
  precioTransportistaExterno?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaPrecioTransportistaExterno?: string;
  /** % de IVA ya incluido en precioTransportistaExterno (0 = no incluye). Se "netea" al liquidar por CVLP para no duplicar el IVA. */
  @IsOptional()
  @IsNumber({}, { message: 'El % de IVA incluido debe ser un número válido.' })
  @Min(0, { message: 'El % de IVA incluido no puede ser negativo.' })
  @Max(100, { message: 'El % de IVA incluido no puede superar 100.' })
  @Type(() => Number)
  precioTransportistaIvaIncluidoPct?: number;

  @ValidateIf((o) => o.cantidadFactura != null || o.precioUnitarioFactura != null)
  @IsNumber({}, { message: 'La cantidad a facturar debe ser un número válido' }) @Type(() => Number) cantidadFactura?: number;

  @ValidateIf((o) => o.cantidadFactura != null || o.precioUnitarioFactura != null)
  @IsNumber({}, { message: 'El precio unitario a facturar debe ser un número válido' }) @Type(() => Number) precioUnitarioFactura?: number;

  @ValidateIf((o) => o.cantidadTransportista != null || o.precioUnitarioTransportista != null)
  @IsNumber({}, { message: 'La cantidad del transportista debe ser un número válido' }) @Type(() => Number) cantidadTransportista?: number;

  @ValidateIf((o) => o.cantidadTransportista != null || o.precioUnitarioTransportista != null)
  @IsNumber({}, { message: 'El precio unitario del transportista debe ser un número válido' }) @Type(() => Number) precioUnitarioTransportista?: number;

  @IsOptional()
  @IsNumber({}, { message: 'La ganancia bruta manual debe ser un número válido.' })
  @Min(0, { message: 'La ganancia bruta manual no puede ser negativa.' })
  @Type(() => Number)
  gananciaBrutaManual?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaGananciaBrutaManual?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OtroGastoDto) otrosGastos?: OtroGastoDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PagoTransportistaDto) pagosTransportista?: PagoTransportistaDto[];
}
