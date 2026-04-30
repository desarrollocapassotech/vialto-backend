import { IsIn, IsNumber, IsOptional, IsString, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddPagoTransportistaDto {
  @IsNumber() @Min(0) @Type(() => Number) monto: number;
  @IsIn(['ARS', 'USD']) moneda: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsString() comprobante?: string;
  @IsOptional()
  @IsIn(['efectivo', 'transferencia', 'cheque', 'otro'])
  metodo?: string;
}
