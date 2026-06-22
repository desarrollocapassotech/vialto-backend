import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductoPresentacionItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  presentacionId!: string;

  @IsInt()
  @Min(1)
  unidadesPorBulto!: number;
}

export class CreateProductoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsNumber()
  @IsPositive()
  pesoUnitarioKg!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductoPresentacionItemDto)
  presentaciones!: ProductoPresentacionItemDto[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
