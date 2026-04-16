import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PreviewImportDto {
  @IsString()
  @IsNotEmpty()
  modulo: string;

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
