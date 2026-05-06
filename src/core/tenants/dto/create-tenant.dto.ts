import {
  IsString,
  IsNotEmpty,
  IsOptional,
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
  idFiscal?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @IsNotEmpty()
  clerkOrgId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];
}
