import { IsArray, IsOptional, IsString } from 'class-validator';

export class MarcarLeidasDto {
  /** Ids de `NotificacionEnvio` a marcar como leídos. Si se omite, marca todos los no leídos del tenant. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}
