import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Línea de una venta/compra manual: importe SIN IVA y su alícuota (como una línea de factura). */
export class LineaMovimientoCcDto {
  @IsString() descripcion: string;
  @IsNumber() @Type(() => Number) importe: number;
  @IsNumber() @Min(0) @Max(100) @Type(() => Number) ivaPct: number;
}

export class CreateMovimientoCcDto {
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() proveedorId?: string;
  @IsIn(['cargo', 'pago']) tipo: string;
  @IsOptional() @IsString() concepto?: string;
  /**
   * Con `ivaPct`, es el importe SIN IVA: el servicio guarda como `importe` el total (neto + IVA).
   * Con `lineas`, se ignora: el total sale de las líneas.
   */
  @IsOptional() @IsNumber() @Type(() => Number) importe?: number;
  /** % de IVA, solo para cargos (venta/compra). Vacío o 0 = sin IVA. */
  @IsOptional() @IsNumber() @Min(0) @Max(100) @Type(() => Number) ivaPct?: number;
  /** Solo cargos (venta/compra): varias líneas, cada una con su importe neto e IVA. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaMovimientoCcDto)
  lineas?: LineaMovimientoCcDto[];
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
  @IsOptional() @IsString() numeroComprobante?: string;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsString() referencia?: string;
  /**
   * Solo cobros/pagos: cargos (facturas/liquidaciones) a los que se imputa al registrarlo.
   * El importe se reparte del más viejo al más nuevo; lo que sobre queda a cuenta.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) imputarACargoIds?: string[];
}
