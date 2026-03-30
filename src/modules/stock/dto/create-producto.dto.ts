import { IsIn, IsString, IsNotEmpty } from 'class-validator';

export class CreateProductoDto {
  @IsString() @IsNotEmpty() nombre: string;
  @IsIn(['kg', 'unidad', 'palet', 'rollo', 'otro']) unidad: string;
}
