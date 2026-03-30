import { IsDateString, IsIn, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateRemitoDto {
  @IsString() @IsNotEmpty() numero: string;
  @IsString() @IsNotEmpty() clienteId: string;
  @IsOptional() @IsString() choferId?: string;
  @IsOptional() @IsString() vehiculoId?: string;
  @IsString() @IsNotEmpty() descripcion: string;
  @IsDateString() fecha: string;
  @IsOptional() @IsString() firmaUrl?: string;
  @IsOptional()
  @IsIn(['emitido', 'firmado', 'facturado'])
  estado?: string;
}
