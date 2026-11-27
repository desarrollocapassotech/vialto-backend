import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

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

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === '' || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  @Min(0)
  pesoTn?: number | null;

  @IsOptional()
  @IsString()
  presentacionId?: string | null;
}
