import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePaisDto {
  @ApiProperty({ example: 'Paraguay' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  })
  nombre: string;

  @ApiProperty({ example: 'PY', minLength: 2, maxLength: 2 })
  @IsString()
  @IsNotEmpty()
  @Length(2, 2, { message: 'El código debe tener 2 letras (ISO 3166-1 alpha-2).' })
  @Matches(/^[A-Z]{2}$/, { message: 'El código debe tener 2 letras (ISO 3166-1 alpha-2).' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  codigo: string;
}