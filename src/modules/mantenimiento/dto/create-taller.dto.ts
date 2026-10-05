import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTallerDto {
  @ApiProperty({ example: 'Taller Diesel Norte' })
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el nombre del taller.' })
  @MaxLength(120)
  @Transform(trim)
  nombre: string;

  @ApiPropertyOptional({
    example: '20-12345678-6',
    nullable: true,
    description: 'Se guarda solo con dígitos; se valida el dígito verificador',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  cuit?: string | null;

  @ApiPropertyOptional({ example: '+54 341 555-1234', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  telefono?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
