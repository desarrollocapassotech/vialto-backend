import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { DASHBOARD_BLOQUES } from './update-tenant.dto';

/** Bloques del dashboard en orden, que arma el admin de la empresa. [] = set recomendado. */
export class DashboardBloquesDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(DASHBOARD_BLOQUES, { each: true })
  dashboardBloques!: string[];
}
