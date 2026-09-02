import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { TenantFieldConfigService } from "./tenant-field-config.service";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TenantGuard } from "../../shared/guards/tenant.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthPayload } from "../auth/clerk-auth.guard";
import { assertTenantId } from "../../shared/util/assert-tenant";
import { ToggleFieldConfigDto } from "./dto/toggle-field-config.dto";

@ApiTags("Field Config — Tenant")
@ApiBearerAuth("clerk-jwt")
@Controller("field-config")
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class TenantFieldConfigController {
  constructor(private readonly service: TenantFieldConfigService) {}

  /** Resuelve el tenantId efectivo: superadmin puede operar sobre cualquier tenant. */
  private resolveTenantId(auth: AuthPayload, overrideTenantId?: string): string {
    const tenantId =
      auth.role === "superadmin" && overrideTenantId
        ? overrideTenantId
        : auth.tenantId;
    assertTenantId(tenantId);
    return tenantId as string;
  }

  @ApiOperation({
    summary:
      "Obtiene la configuración de campos de un módulo para el tenant actual",
  })
  @Get(":modulo")
  getConfigModulo(
    @Param("modulo") modulo: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getConfigEfectivaModulo(auth.tenantId, modulo);
  }

  @ApiOperation({
    summary:
      "Obtiene la configuración (con labels) de un formulario puntual para el tenant actual — pantalla de autoservicio 'Configuración por empresa'",
  })
  @Get(":modulo/:formulario")
  @Roles("admin", "member", "superadmin")
  getConfigFormulario(
    @Param("modulo") modulo: string,
    @Param("formulario") formulario: string,
    @CurrentAuth() auth: AuthPayload,
    @Query("tenantId") tenantId?: string,
  ) {
    return this.service.getConfigEfectiva(
      this.resolveTenantId(auth, tenantId),
      modulo,
      formulario,
    );
  }

  @ApiOperation({
    summary:
      "Activa/oculta un campo opcional para el tenant actual (autoservicio de admin de empresa)",
  })
  @Post("toggle")
  @Roles("admin", "superadmin")
  toggleCampo(
    @Body() dto: ToggleFieldConfigDto,
    @CurrentAuth() auth: AuthPayload,
    @Query("tenantId") tenantId?: string,
  ) {
    return this.service.toggleCampo(
      this.resolveTenantId(auth, tenantId),
      dto,
      auth.userId,
    );
  }
}
