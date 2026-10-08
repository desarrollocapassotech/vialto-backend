import { IsArray, IsOptional, IsString } from 'class-validator';

export class MarcarLeidasDto {
  /** Ids de `NotificacionEnvio` a marcar como leídos. Si se omiten (y `tipo` también), marca todos los no leídos del tenant. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  /** Marca como leídos todos los avisos de este tipo (ej. al abrir su grupo en la página de Notificaciones). */
  @IsOptional()
  @IsString()
  tipo?: string;
}
