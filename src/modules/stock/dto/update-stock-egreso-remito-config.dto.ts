import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateStockEgresoRemitoConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9\-]+$/, { message: 'El prefijo solo puede incluir letras, números y guiones.' })
  remitoPrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(12)
  @Type(() => Number)
  remitoDigitos?: number;
}
