import { ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class ViajeIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  viajeIds: string[];

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
