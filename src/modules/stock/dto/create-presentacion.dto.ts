import { IsNotEmpty, IsNumber, IsPositive, IsString, MaxLength } from 'class-validator';

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

}
