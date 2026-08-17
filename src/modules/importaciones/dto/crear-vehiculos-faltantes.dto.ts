import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class VehiculoFaltanteDto {
  @IsString()
  patente: string;

  @IsString()
  tipo: string;
}

export class CrearVehiculosFaltantesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VehiculoFaltanteDto)
  items: VehiculoFaltanteDto[];

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
