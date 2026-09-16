import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EditarKmVehiculoDto {
  @IsInt() @Min(0) @Type(() => Number) kmNuevo: number;
}
