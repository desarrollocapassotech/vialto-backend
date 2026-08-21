import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdatePaisDto {
  @ApiPropertyOptional({ example: 'Paraguay' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  })
  nombre?: string;

  @ApiPropertyOptional({ example: 'PY', minLength: 2, maxLength: 2 })
  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'El código debe tener 2 letras (ISO 3166-1 alpha-2).' })
  @Matches(/^[A-Z]{2}$/, { message: 'El código debe tener 2 letras (ISO 3166-1 alpha-2).' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  codigo?: string;
}