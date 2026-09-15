import { IsNotEmpty, IsString } from 'class-validator';

export class AsignarVehiculoDto {
  @IsString() @IsNotEmpty() choferId: string;
  @IsString() @IsNotEmpty() vehiculoId: string;
}
