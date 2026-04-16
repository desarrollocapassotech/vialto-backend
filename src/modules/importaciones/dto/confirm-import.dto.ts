import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ConfirmImportDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
