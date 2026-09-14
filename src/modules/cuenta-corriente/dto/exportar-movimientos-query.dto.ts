import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ExportarMovimientosQueryDto {
  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsString()
  proveedorId?: string;

  @IsDateString()
  desde: string;

  @IsDateString()
  hasta: string;
}
