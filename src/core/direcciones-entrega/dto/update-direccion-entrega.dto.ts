import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDireccionEntregaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  direccion?: string;
}
