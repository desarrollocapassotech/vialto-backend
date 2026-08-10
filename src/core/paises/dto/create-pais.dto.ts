import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePaisDto {
  @ApiProperty({ example: 'Paraguay' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nombre: string;

  @ApiPropertyOptional({ example: 'PY', maxLength: 3 })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  codigo?: string;
}