import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateChoferDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() dni?: string;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() transportistaId?: string;
}
