import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsDateString,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class AddGastoDto {
  @IsString() @IsNotEmpty() descripcion: string;
  @IsNumber() @Min(0) @Type(() => Number) monto: number;
  @IsIn(["ARS", "USD"]) moneda: string;
  @IsOptional() @IsDateString() fecha?: string;

  // Cambio para pasar el usuario creador
  @IsOptional() @IsString() createdBy?: string;
}
