import { IsDateString, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateChoferDto {
  @IsString() @IsNotEmpty() nombre: string;
  @IsOptional() @IsString() dni?: string;
  @IsOptional() @IsString() licencia?: string;
  @IsOptional() @IsDateString() licenciaVence?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() transportistaId?: string;
}
