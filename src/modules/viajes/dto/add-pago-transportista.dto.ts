import { IsIn, IsNumber, IsOptional, IsString, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddPagoTransportistaDto {
  @IsNumber({}, { message: 'El monto del pago al transportista debe ser un número válido.' })
  @Min(0, { message: 'El monto del pago al transportista no puede ser negativo.' })
  @Type(() => Number)
  monto: number;
  @IsIn(['ARS', 'USD']) moneda: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsString() comprobante?: string;
  @IsOptional()
  @IsIn(['efectivo', 'transferencia', 'cheque', 'otro'])
  metodo?: string;
}
