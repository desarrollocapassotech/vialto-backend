import { IsString, IsOptional, IsArray, IsIn, IsInt, IsBoolean, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateTenantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];
  @IsOptional() @IsInt() @Type(() => Number) maxUsers?: number;
  @IsOptional() @IsIn(['trial', 'active', 'suspended', 'expired']) billingStatus?: string;
  @IsOptional() @IsDateString() billingRenewsAt?: string;
  @IsOptional() @IsString() labelIdentificacionPersonalizadaViajes?: string;
  /** true = el admin del tenant no ve la pantalla de import masivo (superadmin sigue pudiendo usarla). */
  @IsOptional() @IsBoolean() importacionesOcultas?: boolean;
}
