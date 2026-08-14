import { ArrayMinSize, IsArray, IsObject, IsOptional, IsString } from "class-validator";

export class ConfirmarFacturasClientesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  viajeIds: string[];

  /**
   * Número de comprobante por cliente, solo relevante para tenants sin ARCA
   * (ahí el número representa un comprobante ya numerado externamente). Para
   * tenants con integracion-arca se ignora — la factura se crea sin número,
   * AFIP lo asigna al emitir.
   */
  @IsOptional()
  @IsObject()
  numerosPorCliente?: Record<string, string>;

  /** Solo para superadmin: tenantId del cliente al que se le importa */
  @IsString()
  @IsOptional()
  tenantId?: string;
}
