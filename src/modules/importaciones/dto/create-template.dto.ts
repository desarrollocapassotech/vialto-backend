import { IsString, IsNotEmpty, IsObject, IsOptional, IsBoolean } from 'class-validator';
import type { TemplateConfig } from '../types/import.types';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  modulo: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsObject()
  config: TemplateConfig;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
