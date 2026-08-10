import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { normalizarEtapaViaje, VIAJE_ETAPAS } from "../viaje-estados";
import { ViajeProductoItemDto } from "./viaje-producto-item.dto";
import { ViajeDestinoItemDto } from "./viaje-destino-item.dto";

/** Normaliza ids opcionales del body: trim y convierte "" en null. */
export function normalizeOptionalId({
  value,
}: {
  value: unknown;
}): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export class OtroGastoDto {
  @IsString() @IsNotEmpty() descripcion: string;
  @IsNumber({}, { message: "El monto del gasto debe ser un número válido." })
  @Min(0, { message: "El monto del gasto no puede ser negativo." })
  @Type(() => Number)
  monto: number;
  @IsIn(["ARS", "USD"]) moneda: string;
  @IsOptional() @IsDateString() fecha?: string;
  // Agrego createdBy en el dto
  @IsOptional() @IsString() createdBy?: string;
}

export class PagoTransportistaDto {
  @IsNumber({}, { message: "El monto del pago al transportista debe ser un número válido." })
  @Min(0, { message: "El monto del pago al transportista no puede ser negativo." })
  @Type(() => Number)
  monto: number;
  @IsIn(["ARS", "USD"]) moneda: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() observaciones?: string;
  // Agrego createdBy en el dto
  @IsOptional() @IsString() createdBy?: string;
}

export class CreateViajeDto {
  /** Si no se envía, el servidor asigna un correlativo (AAAA-NNNNNN). */
  @IsOptional() @IsString() numero?: string;
  /** ID propio del cliente para identificar el viaje (ej. CTG). Reemplaza a `numero` en toda vista/documento humano cuando está cargado. */
  @IsOptional() @IsString() numeroIdentificacionPersonalizado?: string;

  @Transform(({ value }) =>
    typeof value === "string" ? normalizarEtapaViaje(value) : value,
  )
  @IsIn(VIAJE_ETAPAS as unknown as [string, ...string[]])
  etapa: string;

  @IsString() @IsNotEmpty() clienteId: string;
  @IsOptional() @IsString() transportistaId?: string;
  /**
   * Si es false, el contratante no realiza el flete y `transportistaEfectivoId` es obligatorio.
   * Por defecto true cuando se omite.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === "true" || value === 1 || value === "1")
      return true;
    if (value === false || value === "false" || value === 0 || value === "0")
      return false;
    return value;
  })
  @IsBoolean()
  contratanteRealizaFlete?: boolean;
  /** Transportista que efectivamente realiza el flete (cuando difiere del contratante). */
  @IsOptional() @IsString() transportistaEfectivoId?: string | null;
  /** Obligatorio si no hay transportista externo. */
  @IsOptional()
  @Transform(normalizeOptionalId)
  @IsString()
  choferId?: string | null;
  /** IDs de vehículos del maestro (orden = orden del array). Requerido al menos 1 sin transportista externo. */
  @IsOptional() @IsArray() @IsString({ each: true }) vehiculoIds?: string[];
  @IsString() @IsNotEmpty() origen: string;
  /** Legacy: un solo destino. Usar `destinos` para rutas con múltiples paradas. */
  @IsOptional() @IsString() @IsNotEmpty() destino?: string;
  /** Destinos ordenados (orden del array = orden de la ruta). Requerido si no se envía `destino`. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ViajeDestinoItemDto)
  destinos?: ViajeDestinoItemDto[];
  @IsDateString() fechaCarga: string;
  @IsDateString() fechaDescarga: string;
  /** Productos a transportar (orden = orden del array). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ViajeProductoItemDto)
  productoItems?: ViajeProductoItemDto[];
  @IsOptional() @IsString() detalleCarga?: string;
  @IsOptional() @IsNumber() @Type(() => Number) kmRecorridos?: number;
  @IsOptional() @IsNumber() @Type(() => Number) litrosConsumidos?: number;
  @ValidateIf((o) => o.cantidadFactura == null && o.precioUnitarioFactura == null)
  @IsNumber({}, { message: "El monto a facturar debe ser un número válido." })
  @Min(0.01, { message: "El monto a facturar debe ser mayor a $0,01." })
  @Type(() => Number)
  monto?: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(["ARS", "USD"]) monedaMonto?: string;
  @IsOptional()
  @IsNumber({}, { message: "El precio del transporte debe ser un número válido." })
  @Type(() => Number)
  precioTransportistaExterno?: number;
  /** ARS (default) o USD. */
  @IsOptional() @IsIn(["ARS", "USD"]) monedaPrecioTransportistaExterno?: string;

  @ValidateIf((o) => o.cantidadFactura != null || o.precioUnitarioFactura != null)
  @IsNumber({}, { message: 'La cantidad a facturar debe ser un número válido' }) @Type(() => Number) cantidadFactura?: number;

  @ValidateIf((o) => o.cantidadFactura != null || o.precioUnitarioFactura != null)
  @IsNumber({}, { message: 'El precio unitario a facturar debe ser un número válido' }) @Type(() => Number) precioUnitarioFactura?: number;

  @ValidateIf((o) => o.cantidadTransportista != null || o.precioUnitarioTransportista != null)
  @IsNumber({}, { message: 'La cantidad del transportista debe ser un número válido' }) @Type(() => Number) cantidadTransportista?: number;

  @ValidateIf((o) => o.cantidadTransportista != null || o.precioUnitarioTransportista != null)
  @IsNumber({}, { message: 'El precio unitario del transportista debe ser un número válido' }) @Type(() => Number) precioUnitarioTransportista?: number;

  /** Solo si monedaMonto ≠ monedaPrecioTransportistaExterno. */
  @IsOptional()
  @IsNumber({}, { message: "La ganancia bruta manual debe ser un número válido." })
  @Min(0, { message: "La ganancia bruta manual no puede ser negativa." })
  @Type(() => Number)
  gananciaBrutaManual?: number;
  @IsOptional() @IsIn(["ARS", "USD"]) monedaGananciaBrutaManual?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtroGastoDto)
  otrosGastos?: OtroGastoDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoTransportistaDto)
  pagosTransportista?: PagoTransportistaDto[];
}
