import { IsString, IsInt, IsNumber, IsIn, IsOptional, Min, Max } from 'class-validator';

export class UpsertArcaConfigDto {
  @IsString()
  cuitEmisor: string;

  @IsOptional() @IsString() razonSocial?: string;
  @IsOptional() @IsString() domicilioEmisor?: string;
  @IsOptional() @IsString() condicionIvaEmisor?: string;
  @IsOptional() @IsString() ingBrutos?: string;
  @IsOptional() @IsString() inicActEmisor?: string;

  @IsInt()
  @Min(1)
  ptoVentaCvlp: number;

  @IsInt()
  @Min(1)
  ptoVentaFactura: number;

  @IsIn(['homologacion', 'produccion'])
  ambiente: 'homologacion' | 'produccion';

  @IsNumber() @Min(0) @Max(100) comisionPctDefault: number;
  @IsNumber() @Min(0) @Max(100) ivaGastosAdmin: number;

  // Comprobante con que se anula un CVLP (NC = tipo 3/8, ND = tipo 2/7).
  @IsOptional()
  @IsIn(['nota_credito', 'nota_debito'])
  anulacionTipoComprobante?: 'nota_credito' | 'nota_debito';

  @IsOptional() @IsString() certPemProduccion?: string;
  @IsOptional() @IsString() keyPemProduccion?: string;
}
