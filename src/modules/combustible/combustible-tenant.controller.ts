import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../core/auth/clerk-auth.guard";
import { RolesGuard } from "../../core/auth/roles.guard";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentAuth } from "../../core/auth/current-auth.decorator";
import type { AuthPayload } from "../../core/auth/clerk-auth.guard";
import { TenantGuard } from "../../shared/guards/tenant.guard";
import { ModuleGuard } from "../../shared/guards/module.guard";
import { RequireModule } from "../../shared/decorators/require-module.decorator";
import { assertTenantId } from "../../shared/util/assert-tenant";
import { CombustibleService } from "./combustible.service";

@ApiTags("Módulo: Combustible")
@ApiBearerAuth("clerk-jwt")
@Controller("combustible")
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule("combustible")
export class CombustibleTenantController {
  constructor(private readonly service: CombustibleService) {}

  @ApiOperation({ summary: "Panel de combustible del tenant (resumen, ranking, alertas, cruce con viajes)" })
  @Get("dashboard")
  @Roles("admin", "member", "superadmin")
  getDashboard(
    @CurrentAuth() auth: AuthPayload,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getDashboard(auth, from, to);
  }
}
