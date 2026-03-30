import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsIn,
  IsArray,
  ValidateIf,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'CUIT debe tener 10 u 11 dígitos' })
  cuit?: string;

  @IsString()
  @IsNotEmpty()
  clerkOrgId: string;

  @IsOptional()
  @IsIn(['basico', 'pro', 'enterprise'])
  plan?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];
}
