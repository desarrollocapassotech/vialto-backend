import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateConceptoLiquidacionDto {
  @IsString()
  @MaxLength(120)
  nombre: string;

  @IsIn(['favor', 'contra'])
  signo: 'favor' | 'contra';

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  ivaPct: number;
}

export class UpdateConceptoLiquidacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsIn(['favor', 'contra'])
  signo?: 'favor' | 'contra';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  ivaPct?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
