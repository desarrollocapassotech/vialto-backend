import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDestinatarioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;
}
