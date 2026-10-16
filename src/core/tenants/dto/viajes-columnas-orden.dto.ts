import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { VIAJES_COLUMNAS_ORDENABLES } from './update-tenant.dto';

/** Orden de columnas de la grilla de Viajes que elige el admin de la empresa. [] = estándar. */
export class ViajesColumnasOrdenDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(VIAJES_COLUMNAS_ORDENABLES, { each: true })
  viajesColumnasOrden!: string[];
}
