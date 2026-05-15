import { IsString, IsInt, IsNumber, IsIn, IsOptional, Min, Max } from 'class-validator';

export class UpsertArcaConfigDto {
  @IsString()
  cuitEmisor: string;

  @IsInt()
  @Min(1)
  ptoVentaCvlp: number;

  @IsInt()
  @Min(1)
  ptoVentaFactura: number;

  @IsIn(['homologacion', 'produccion'])
  ambiente: 'homologacion' | 'produccion';

  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPctDefault: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPctAlt: number;

  @IsNumber()
  @Min(0)
  gastosAdminPorViaje: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  ivaGastosAdmin: number;
}
