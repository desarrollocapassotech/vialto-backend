import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProductoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unidadMedida?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  unidad1Nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  unidad2Nombre?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
