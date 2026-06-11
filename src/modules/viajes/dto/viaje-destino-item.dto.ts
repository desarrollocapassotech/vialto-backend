import { IsNotEmpty, IsString } from 'class-validator';

export class ViajeDestinoItemDto {
  @IsString()
  @IsNotEmpty()
  etiqueta: string;
}
