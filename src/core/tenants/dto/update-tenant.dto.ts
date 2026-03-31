import { IsString, IsOptional, IsArray, IsIn, IsInt, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateTenantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() cuit?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];
  @IsOptional() @IsInt() @Type(() => Number) maxUsers?: number;
  @IsOptional() @IsIn(['trial', 'active', 'suspended']) billingStatus?: string;
  @IsOptional() @IsDateString() billingRenewsAt?: string;
  @IsOptional() @IsString() whiteLabelDomain?: string;
}
