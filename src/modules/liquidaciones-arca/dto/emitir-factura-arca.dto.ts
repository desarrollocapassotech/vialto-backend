import { IsInt, IsIn } from 'class-validator';

export class EmitirFacturaArcaDto {
  /** 1=Factura A, 6=Factura B */
  @IsInt()
  @IsIn([1, 6])
  cbteTipo: 1 | 6;
}
