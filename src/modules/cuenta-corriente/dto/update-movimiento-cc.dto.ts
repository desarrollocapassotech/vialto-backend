import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompraViajeDto, LineaMovimientoCcDto } from './create-movimiento-cc.dto';

export class UpdateMovimientoCcDto {
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() proveedorId?: string;
  @IsOptional() @IsIn(['cargo', 'pago']) tipo?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() @Type(() => Number) importe?: number;
  /** Solo ventas/compras: reemplaza las líneas (importe neto + IVA %); el total se recalcula. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaMovimientoCcDto)
  lineas?: LineaMovimientoCcDto[];
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
  @IsOptional() @IsDateString() fecha?: string;
  /** null = quitar el vencimiento. */
  @IsOptional() @IsDateString() fechaVencimiento?: string | null;
  @IsOptional() @IsString() numeroComprobante?: string;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsString() referencia?: string;
  /**
   * Solo compras: reemplaza los viajes vinculados (`[]` = sin viajes). Sin el campo no se
   * tocan; si cambia el importe, el reparto se reescala proporcionalmente.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompraViajeDto)
  viajes?: CompraViajeDto[];
}
