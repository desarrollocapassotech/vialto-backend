import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class ToggleFieldConfigDto {
  @IsString()
  @IsNotEmpty()
  modulo: string;

  @IsString()
  @IsNotEmpty()
  formulario: string;

  @IsString()
  @IsNotEmpty()
  campo: string;

  @IsBoolean()
  visible: boolean;

  /** Si viene en true, replica el mismo toggle a todos los formularios del módulo. */
  @IsOptional()
  @IsBoolean()
  aplicarATodosLosFormularios?: boolean;
}