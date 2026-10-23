import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LineaMovimientoCcDto } from './create-movimiento-cc.dto';

/**
 * Un comprobante del Excel "Mis Comprobantes" de AFIP, ya interpretado por el front:
 * CUIT de la contraparte, número armado, fecha, moneda y líneas por alícuota.
 */
export class FilaAfipDto {
  /** Fila del Excel (solo para devolver el resultado de cada una). */
  @IsInt() @Type(() => Number) fila: number;
  /** CUIT del receptor (ventas, "Emitidos") o del emisor (compras, "Recibidos"). */
  @IsString() cuit: string;
  @IsOptional() @IsString() denominacion?: string;
  /** Ej. "Factura C 00001-00000094". */
  @IsString() numeroComprobante: string;
  /** YYYY-MM-DD. */
  @IsDateString() fecha: string;
  @IsIn(['ARS', 'USD']) moneda: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaMovimientoCcDto)
  lineas: LineaMovimientoCcDto[];
}

export class ImportarAfipDto {
  /** cliente = ventas (Excel de comprobantes emitidos); proveedor = compras (recibidos). */
  @IsIn(['cliente', 'proveedor']) lado: 'cliente' | 'proveedor';
  /** true = solo vista previa (qué se importaría), sin crear nada. */
  @IsOptional() @IsBoolean() simular?: boolean;
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => FilaAfipDto)
  filas: FilaAfipDto[];
}
