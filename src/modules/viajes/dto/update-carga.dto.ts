import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCargaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unidadMedida?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
