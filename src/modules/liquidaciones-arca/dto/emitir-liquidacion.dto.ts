import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class EmitirLiquidacionDto {
  // Punto de venta CVLP a usar en esta emisión. Si no se envía, se usa
  // el ptoVentaCvlp configurado en ArcaConfig para el tenant.
  @IsOptional()
  @IsInt()
  @Min(1)
  ptoVenta?: number;

  // Fecha de emisión del CVLP (`YYYY-MM-DD`). Si no se envía, se usa hoy.
  // Tiene que caer en la ventana de AFIP (±5 días, sin pasar al mes siguiente) y no
  // ser anterior al último comprobante del punto de venta.
  @IsOptional()
  @IsDateString()
  fechaEmision?: string;
}
