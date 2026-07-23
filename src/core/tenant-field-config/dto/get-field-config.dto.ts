import { IsString, IsNotEmpty } from 'class-validator';

export class GetFieldConfigDto {
  @IsString()
  @IsNotEmpty()
  modulo: string;

  @IsString()
  @IsNotEmpty()
  formulario: string;
}