import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDireccionEntregaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  direccion!: string;
}
