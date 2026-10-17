import { IsString, IsInt, IsNumber, IsIn, IsOptional, Matches, Min, Max, MaxLength } from 'class-validator';

const COLOR_HEX_O_VACIO = /^(#[0-9a-fA-F]{6})?$/;

export class UpsertArcaConfigDto {
  @IsString()
  cuitEmisor: string;

  @IsOptional() @IsString() razonSocial?: string;
  @IsOptional() @IsString() domicilioEmisor?: string;
  @IsOptional() @IsString() condicionIvaEmisor?: string;
  @IsOptional() @IsString() ingBrutos?: string;
  @IsOptional() @IsString() inicActEmisor?: string;
  /** Leyenda en letra chica bajo la condición de venta del PDF de factura. Vacío = sin leyenda. */
  @IsOptional() @IsString() @MaxLength(1000) leyendaFactura?: string;
  /** Color de acento del PDF ("#RRGGBB"). Vacío = blanco y negro. */
  @IsOptional() @IsString() @Matches(COLOR_HEX_O_VACIO, { message: 'El color debe tener el formato #RRGGBB.' })
  colorFactura?: string;
  @IsOptional() @IsString() @Matches(COLOR_HEX_O_VACIO, { message: 'El color debe tener el formato #RRGGBB.' })
  colorLiquidacion?: string;

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
