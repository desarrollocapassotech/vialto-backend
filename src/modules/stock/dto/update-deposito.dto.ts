import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateDepositoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
