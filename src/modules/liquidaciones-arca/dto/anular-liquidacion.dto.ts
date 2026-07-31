import { IsIn, IsOptional } from 'class-validator';

export class AnularLiquidacionDto {
  // Comprobante con que se anula el CVLP. Si no se envía, se usa el default del tenant.
  @IsOptional()
  @IsIn(['nota_credito', 'nota_debito'])
  tipoAnulacion?: 'nota_credito' | 'nota_debito';
}
