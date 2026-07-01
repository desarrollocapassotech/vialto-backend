import { Matches } from 'class-validator';

export class ChoferLoginDto {
  @Matches(/^\d{7,8}$/, { message: 'DNI debe tener 7 u 8 dígitos' })
  dni: string;

  @Matches(/^\d{4}$/, { message: 'PIN debe tener 4 dígitos' })
  pin: string;
}
