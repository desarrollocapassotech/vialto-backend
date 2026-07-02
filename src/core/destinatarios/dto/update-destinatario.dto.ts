import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDestinatarioDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre?: string;
}
