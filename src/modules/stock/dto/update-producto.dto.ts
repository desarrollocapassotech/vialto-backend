import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateProductoDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsIn(['kg', 'unidad', 'palet', 'rollo', 'otro']) unidad?: string;
}
