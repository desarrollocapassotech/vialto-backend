import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDepositoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  activo?: boolean;
}
