import { IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class UpdatePresentacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  cantidadEquivalente?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unidadEquivalente?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoKg?: number;
}
