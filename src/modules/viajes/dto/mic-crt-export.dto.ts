import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MIC_CRT_TIPOS_BULTOS = [
  'PALETA',
  'CAJA',
  'BOLSA',
  'TAMBOR',
  'CONTENEDOR',
  'BULTO',
  'GRANEL',
  'OTRO',
] as const;

export class MicCrtActorDto {
  @IsString() @IsNotEmpty() razonSocial: string;
  @IsString() @IsNotEmpty() idFiscal: string;
  @IsString() @IsNotEmpty() calle: string;
  @IsString() @IsNotEmpty() numero: string;
  @IsString() @IsNotEmpty() ciudad: string;
  @IsString() @IsNotEmpty() pais: string;
}

export class MicCrtSemirremolqueDto {
  @IsOptional() @IsString() propietario?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsString() patente?: string;
  @IsOptional() @IsString() marca?: string;
  @IsOptional() @IsNumber() @Type(() => Number) anio?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) capacidadArrastreT?: number;
}

export class MicCrtExportDto {
  @IsString() @IsNotEmpty() micNumero: string;
  @IsString() @IsNotEmpty() crtNumero: string;
  /** ISO date YYYY-MM-DD */
  @IsString() @IsNotEmpty() fechaEmision: string;

  @ValidateNested() @Type(() => MicCrtActorDto) remitente: MicCrtActorDto;
  @ValidateNested() @Type(() => MicCrtActorDto) destinatario: MicCrtActorDto;
  @ValidateNested() @Type(() => MicCrtActorDto) consignatario: MicCrtActorDto;
  @IsOptional() @ValidateNested() @Type(() => MicCrtActorDto) notificarA?: MicCrtActorDto;

  @IsString() @IsNotEmpty() ncm: string;
  @IsNumber() @Min(0) @Type(() => Number) bultos: number;
  @IsString() @IsNotEmpty() @IsIn([...MIC_CRT_TIPOS_BULTOS]) tipoBultos: string;
  @IsNumber() @Min(0) @Type(() => Number) pesoBrutoKg: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) volumenM3?: number;

  @IsNumber() @Min(0) @Type(() => Number) valorFot: number;
  @IsIn(['ARS', 'USD']) monedaFot: string;
  @IsNumber() @Min(0) @Type(() => Number) flete: number;
  @IsIn(['ARS', 'USD']) monedaFlete: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) seguroUsd?: number;
  @IsIn(['origen', 'destino']) condicionPago: 'origen' | 'destino';

  @IsString() @IsNotEmpty() aduanaPartida: string;
  /** País de la aduana de partida (MIC campo 7). */
  @IsOptional() @IsString() partidaPais?: string;
  /** Nombre/código de la aduana de partida (MIC campo 7). */
  @IsOptional() @IsString() aduanaEspecificaPartida?: string;
  /** Código aduanero / lugar operativo de partida (MIC campos 7 y 24). */
  @IsOptional() @IsString() codigoLugarOperativoPartida?: string;
  @IsString() @IsNotEmpty() aduanaDestino: string;
  /** País de destino final (MIC campo 8). */
  @IsOptional() @IsString() destinoPais?: string;
  /** Origen comercial de las mercancías (MIC campo 26). */
  @IsOptional() @IsString() origenComercial?: string;
  /** País del origen comercial (MIC campo 26; si falta, se usa partidaPais). */
  @IsOptional() @IsString() origenComercialPais?: string;
  /** Código aduanero del origen comercial (MIC campo 26; si falta, codigoLugarOperativoPartida). */
  @IsOptional() @IsString() origenComercialCodigoAduanero?: string;

  @IsOptional() @IsString() documentosAnexos?: string;
  @IsOptional() @IsString() precintos?: string;
  @IsOptional() @IsString() cartaPorte?: string;
  @IsOptional() @IsString() ruta?: string;
  @IsOptional() @IsString() descripcionMercaderias?: string;
  @IsOptional() @ValidateNested() @Type(() => MicCrtSemirremolqueDto) semirremolque?: MicCrtSemirremolqueDto;
  @IsOptional() @IsString() porteadorDomicilio?: string;
  @IsOptional() @IsString() porteadorPais?: string;
  @IsOptional() @IsIn(['ARS', 'USD']) monedaDocumento?: string;
}
