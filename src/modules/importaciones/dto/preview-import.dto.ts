import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PreviewImportDto {
  @IsString()
  @IsNotEmpty()
  modulo: string;

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;

  /**
   * Hoja del Excel a leer, tal como la devolvió `POST detectar-hojas`. Pisa la
   * hoja configurada en la plantilla (la detección pudo reconocerla por sus
   * encabezados aunque se llame distinto, ej. "Hoja1").
   */
  @IsString()
  @IsOptional()
  hoja?: string;
}
