import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Lo que el interesado puede querer resolver (checkboxes de la landing). */
export const LEAD_NECESIDADES = {
  viajes: 'Gestión de viajes',
  facturacion: 'Facturación',
  liquidaciones: 'Liquidaciones',
  'cuenta-corriente': 'Cuenta corriente',
  combustible: 'Control de combustible',
  mantenimiento: 'Mantenimiento de flota',
  stock: 'Gestión de stock',
  'a-medida': 'Sistema a medida',
  otro: 'Otro',
} as const;

export type LeadNecesidad = keyof typeof LEAD_NECESIDADES;

export const LEAD_CONTACTO = { whatsapp: 'Mensaje de WhatsApp', llamada: 'Llamada' } as const;

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateLeadDto {
  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'Completá el nombre de la empresa.' })
  @MaxLength(150)
  empresa!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'Completá tu nombre.' })
  @MaxLength(150)
  nombre!: string;

  @Transform(recortar)
  @IsString()
  @Matches(/^[+\d][\d\s()-]{5,30}$/, { message: 'Revisá el número de teléfono.' })
  telefono!: string;

  @IsIn(Object.keys(LEAD_CONTACTO), { message: 'Elegí cómo preferís que te contactemos.' })
  contactoPreferido!: keyof typeof LEAD_CONTACTO;

  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'Contanos en qué días y horarios te podemos contactar.' })
  @MaxLength(500)
  disponibilidad!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Elegí al menos una opción de lo que necesitás resolver.' })
  @ArrayMaxSize(Object.keys(LEAD_NECESIDADES).length)
  @IsIn(Object.keys(LEAD_NECESIDADES), { each: true, message: 'Opción no válida.' })
  necesidades!: LeadNecesidad[];

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  otroDetalle?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(2000)
  comentarios?: string;

  /** De dónde llegó (utm_source/utm_campaign, ej. reel de Instagram). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  origen?: string;

  /** Trampa para bots: campo oculto en la landing. Si viene con algo, se descarta en silencio. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  sitio?: string;
}
