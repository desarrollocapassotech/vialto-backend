import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString } from 'class-validator';

/** Imputar un comprobante con dos cobros/pagos a la vez (el reparto lo decide el servidor). */
export class CreateImputacionMultipleCcDto {
  @IsString()
  @IsNotEmpty()
  cargoId: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ArrayUnique({ message: 'No se puede elegir el mismo cobro dos veces' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  pagoIds: string[];
}
