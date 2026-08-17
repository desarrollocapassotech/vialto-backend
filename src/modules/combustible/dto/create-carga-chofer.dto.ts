import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/** DTO para que el chofer registre una carga desde vialto-combustible. Recibe patente en lugar de vehiculoId. */
export class CreateCargaChoferDto {
  @IsString() @IsNotEmpty() patente: string;
  @IsString() @IsNotEmpty() estacion: string;
  @IsNumber() @Type(() => Number) litros: number;
  @IsNumber() @Type(() => Number) precioPorLitro: number;
  @IsNumber() @Type(() => Number) importe: number;
  @IsNumber() @Type(() => Number) km: number;
  @IsOptional() @IsString() formaPago?: string;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsString() fotoTacometro?: string;
  @IsOptional() @IsString() fotoTicket?: string;
  // COMB-07-T5: id de IndexedDB de la carga en la cola offline, presente solo cuando este
  // alta viene de un reintento de sincronización — permite resolver automáticamente el
  // CombustibleSyncErrorLog que haya quedado registrado para ese mismo intento.
  @IsOptional() @IsString() localId?: string;

  // Timestamp del dispositivo en el momento en que el chofer apretó Guardar.
  // Es la fuente de la verdad para validar el orden cronológico en el modo offline.
  @IsOptional() @IsDateString() createdAt?: string;
}
