import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ViajeDestinoItemDto } from "./viaje-destino-item.dto";
import { ViajeProductoItemDto } from "./viaje-producto-item.dto";

/**
 * Cliente adicional del viaje (multi-cliente, opcional): origen/destino(s)/productos y
 * cobro propios — mismo shape/convención que el viaje (destinos[]/productoItems, y
 * cantidad×precioUnitario o monto directo, sin selector de "forma de cobro").
 */
export class ViajeClienteItemDto {
  @IsString() @IsNotEmpty() clienteId: string;
  @IsOptional() @IsString() origen?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ViajeDestinoItemDto)
  destinos?: ViajeDestinoItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ViajeProductoItemDto)
  productos?: ViajeProductoItemDto[];

  @IsOptional()
  @IsNumber({}, { message: "El monto del cliente debe ser un número válido." })
  @Min(0.01, { message: "El monto del cliente debe ser mayor a $0,01." })
  @Type(() => Number)
  monto?: number;

  @IsOptional() @IsString() monedaMonto?: string;

  @IsOptional()
  @IsNumber({}, { message: "La cantidad debe ser un número válido." })
  @Min(0, { message: "La cantidad no puede ser negativa." })
  @Type(() => Number)
  cantidad?: number;

  @IsOptional()
  @IsNumber({}, { message: "El precio unitario debe ser un número válido." })
  @Min(0, { message: "El precio unitario no puede ser negativo." })
  @Type(() => Number)
  precioUnitario?: number;
}
