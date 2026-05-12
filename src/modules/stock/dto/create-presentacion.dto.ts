import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreatePresentacionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @IsNumber()
  @IsPositive()
  cantidadEquivalente!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unidadEquivalente!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoKg?: number;
}
