import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductoPresentacionItemDto } from './create-producto.dto';

export class UpdateProductoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  pesoUnitarioKg?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductoPresentacionItemDto)
  presentaciones?: ProductoPresentacionItemDto[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
