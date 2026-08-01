import { IsInt, IsOptional, Min } from 'class-validator';

export class EmitirLiquidacionDto {
  // Punto de venta CVLP a usar en esta emisión. Si no se envía, se usa
  // el ptoVentaCvlp configurado en ArcaConfig para el tenant.
  @IsOptional()
  @IsInt()
  @Min(1)
  ptoVenta?: number;
}
