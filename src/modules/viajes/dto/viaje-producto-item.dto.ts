import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ViajeProductoItemDto {
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  pesoKg?: number;
}
