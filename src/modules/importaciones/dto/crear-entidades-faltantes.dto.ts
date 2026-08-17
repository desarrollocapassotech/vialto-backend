import { ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class CrearEntidadesFaltantesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  valores: string[];

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
