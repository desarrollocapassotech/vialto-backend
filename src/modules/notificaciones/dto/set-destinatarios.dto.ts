import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class SetDestinatariosDto {
  @IsString()
  @IsNotEmpty()
  tipo: string;

  /** userIds de Clerk. Vacío = volver al default (todos los org:admin). */
  @IsArray()
  @IsString({ each: true })
  destinatarios: string[];
}
