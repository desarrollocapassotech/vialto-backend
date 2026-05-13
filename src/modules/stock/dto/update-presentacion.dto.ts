import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

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

}
