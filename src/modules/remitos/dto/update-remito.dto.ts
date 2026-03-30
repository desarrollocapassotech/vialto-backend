import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateRemitoDto {
  @IsOptional() @IsString() numero?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsString() vehiculoId?: string;
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsString() firmaUrl?: string;
  @IsOptional()
  @IsIn(['emitido', 'firmado', 'facturado'])
  estado?: string;
}
