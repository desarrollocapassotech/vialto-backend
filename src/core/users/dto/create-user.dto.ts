import { IsString, IsNotEmpty, IsOptional, IsInt, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUserDto {
  @IsString() @IsNotEmpty() clerkUserId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() lastName: string;

  // Para choferes (operadores)
  @IsOptional() @IsInt() @Type(() => Number) dni?: number;
  @IsOptional() @IsString() patente?: string;

  // Para admins
  @IsOptional() @IsEmail() email?: string;
}
