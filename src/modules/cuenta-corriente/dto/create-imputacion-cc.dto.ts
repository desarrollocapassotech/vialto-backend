import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateImputacionCcDto {
  @IsString()
  @IsNotEmpty()
  pagoId: string;

  @IsString()
  @IsNotEmpty()
  cargoId: string;

  @IsNumber()
  @Type(() => Number)
  importe: number;
}
