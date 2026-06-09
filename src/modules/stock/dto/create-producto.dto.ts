import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateProductoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  presentacion1Id!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  presentacion2Id?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
