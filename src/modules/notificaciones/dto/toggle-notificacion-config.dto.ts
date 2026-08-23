import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class ToggleNotificacionConfigDto {
  @IsString()
  @IsNotEmpty()
  tipo: string;

  @IsBoolean()
  activo: boolean;
}
