import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class ExportarMovimientosQueryDto {
  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsDateString()
  desde: string;

  @IsDateString()
  hasta: string;
}
