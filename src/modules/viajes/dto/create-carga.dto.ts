import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCargaDto {
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
}
