import {
  ArrayUnique,
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsInt,
  IsBoolean,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Columnas reordenables de la grilla de Viajes (Tenant.viajesColumnasOrden).
 * Espejo de `VIAJES_COLUMNAS` en `vialto-frontend/src/lib/viajesColumnasOrden.ts`:
 * si se agrega una columna a la grilla, sumarla en los dos lados.
 */
export const VIAJES_COLUMNAS_ORDENABLES = [
  'idSistema',
  'idPropio1',
  'idPropio2',
  'cliente',
  'transporte',
  'chofer',
  'origenDestino',
  'cargaDescarga',
  'productos',
  'etapa',
  'observaciones',
] as const;

export class UpdateTenantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() idFiscal?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];
  @IsOptional() @IsInt() @Type(() => Number) maxUsers?: number;
  @IsOptional() @IsIn(['trial', 'active', 'suspended', 'expired']) billingStatus?: string;
  @IsOptional() @IsDateString() billingRenewsAt?: string;
  @IsOptional() @IsString() labelIdentificacionPersonalizadaViajes?: string;
  /** true = muestra la columna/campo dedicado "ID Sistema" en Viajes. */
  @IsOptional() @IsBoolean() idSistemaHabilitado?: boolean;
  /** true = muestra el campo/columna dedicado "ID Propio 1" en Viajes. */
  @IsOptional() @IsBoolean() idPropio1Habilitado?: boolean;
  /** true = habilita el campo "ID Propio 2" (texto libre, no único) en Viajes. */
  @IsOptional() @IsBoolean() idPropio2Habilitado?: boolean;
  /** Label configurable del campo "ID Propio 2". */
  @IsOptional() @IsString() idPropio2Label?: string | null;
  /** true = el admin del tenant no ve la pantalla de import masivo (superadmin sigue pudiendo usarla). */
  @IsOptional() @IsBoolean() importacionesOcultas?: boolean;

  @IsOptional()
  @IsBoolean()
  habilitarExportacionPautMicCrt?: boolean;
  /**
   * Método de anulación del CVLP (060) — 'nota_credito_debito' (default) | 'manual'.
   * Solo editable desde superadmin (panel Empresas). Ver Liquidacion.estado en schema.prisma.
   */
  @IsOptional() @IsIn(['nota_credito_debito', 'manual']) liquidacionAnulacionMetodo?: string;

  /** true = oculta el selector de país en origen/destino de Viajes (ver Tenant en schema.prisma). */
  @IsOptional() @IsBoolean() paisOrigenDestinoOculto?: boolean;
  /** Id de Pais (catálogo del tenant) a usar cuando paisOrigenDestinoOculto=true. null = desfijar. */
  @IsOptional() @IsString() paisOrigenDestinoFijoId?: string | null;

  /** Unidad de cantidad de flete del tenant — 'TN' | 'UD'. Afecta PDFs (Factura/Liquidación/Contrato) y formularios de Viajes. */
  @IsOptional() @IsIn(['TN', 'UD']) unidadCantidadViajes?: string;

  /** true = valida el CUIT de clientes/transportistas contra el padrón de ARCA (ver core/padron). */
  @IsOptional() @IsBoolean() validacionCuitArcaHabilitada?: boolean;

  /** Con qué flota trabaja la empresa (ver Tenant.tipoFlota en schema.prisma). */
  @IsOptional() @IsIn(['mixta', 'propia', 'externa']) tipoFlota?: string;

  /** false = el tenant no ve el dashboard; su inicio pasa a ser el primer módulo contratado. */
  @IsOptional() @IsBoolean() dashboardHabilitado?: boolean;

  /** false = origen/destino de Viajes en texto libre, sin buscador de ciudades ni validación en el import. */
  @IsOptional() @IsBoolean() recomendacionCiudadesHabilitada?: boolean;

  /** true = habilita "Marcar como cobrada" en Facturas (default false: oculta y el endpoint la rechaza). */
  @IsOptional() @IsBoolean() marcarCobradaHabilitada?: boolean;

  /** false = Mantenimiento solo con órdenes de trabajo (sin planes, vencimientos ni avisos). Default true. */
  @IsOptional() @IsBoolean() mantenimientoPlanesHabilitados?: boolean;

  /** Opciones de proveedores/entidades para el contrato comercial PDF de liquidaciones. */
  @IsOptional() @IsArray() @IsString({ each: true }) opcionesProveedorLiquidacion?: string[];

  /** Orden de columnas de la grilla de Viajes. [] = orden estándar. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(VIAJES_COLUMNAS_ORDENABLES, { each: true })
  viajesColumnasOrden?: string[];

  /** true = la grilla de Viajes muestra la columna de productos. */
  @IsOptional() @IsBoolean() viajesColumnaProductosHabilitada?: boolean;

  /** true = la grilla de Viajes muestra la columna de observaciones. */
  @IsOptional() @IsBoolean() viajesObservaciones?: boolean;

  /** Label que reemplaza a "Producto" (ej. "Grano"). null/"" = "Producto". Sin plural, se genera con IA. */
  @IsOptional() @IsString() @MaxLength(40) productoLabel?: string | null;
  /** Plural del label (corrección manual del generado). */
  @IsOptional() @IsString() @MaxLength(40) productoLabelPlural?: string | null;
}
