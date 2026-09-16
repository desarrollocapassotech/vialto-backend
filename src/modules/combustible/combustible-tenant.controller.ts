import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
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
import { AsignarVehiculoDto } from "./dto/asignar-vehiculo.dto";
import { EditarKmVehiculoDto } from "./dto/editar-km-vehiculo.dto";

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

  @ApiOperation({
    summary:
      "Errores de sincronización offline reportados por choferes (COMB-07-T4)",
  })
  @Get("errores-sincronizacion")
  @Roles("admin", "member", "superadmin")
  getSyncErrors(
    @CurrentAuth() auth: AuthPayload,
    @Query("choferId") choferId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getSyncErrors(auth, choferId);
  }

  @ApiOperation({
    summary: "Límites cronológicos para validación de kilometraje",
  })
  @Get("limites-km")
  @Roles("admin", "member", "superadmin")
  getLimitesKm(
    @CurrentAuth() auth: AuthPayload,
    @Query("vehiculoId") vehiculoId: string,
    @Query("fecha") fecha: string,
    @Query("excludeId") excludeId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getLimitesKm(
      auth.tenantId,
      vehiculoId,
      fecha,
      excludeId,
    );
  }

  @ApiOperation({ summary: "Asignación de vehículo vigente de cada chofer del tenant" })
  @Get("asignaciones")
  @Roles("admin", "member", "superadmin")
  getAsignacionesActuales(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getAsignacionesActuales(auth.tenantId);
  }

  @ApiOperation({ summary: "Historial de asignaciones de un chofer o un vehículo" })
  @Get("asignaciones/historial")
  @Roles("admin", "member", "superadmin")
  getHistorialAsignaciones(
    @CurrentAuth() auth: AuthPayload,
    @Query("choferId") choferId?: string,
    @Query("vehiculoId") vehiculoId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getHistorialAsignaciones(auth.tenantId, { choferId, vehiculoId });
  }

  @ApiOperation({ summary: "Asignar (o reasignar) un vehículo a un chofer" })
  @Post("asignaciones")
  @Roles("admin", "superadmin")
  asignarVehiculo(@CurrentAuth() auth: AuthPayload, @Body() dto: AsignarVehiculoDto) {
    assertTenantId(auth.tenantId);
    return this.service.asignarVehiculo(dto, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      role: auth.role,
    });
  }

  @ApiOperation({ summary: "Terminar la asignación activa de un chofer (queda sin vehículo asignado)" })
  @Delete("asignaciones/:choferId")
  @Roles("admin", "superadmin")
  finalizarAsignacion(@CurrentAuth() auth: AuthPayload, @Param("choferId") choferId: string) {
    assertTenantId(auth.tenantId);
    return this.service.finalizarAsignacion(choferId, auth.tenantId);
  }

  @ApiOperation({ summary: "Corregir el kilometraje de un vehículo (queda auditado)" })
  @Post("vehiculos/:id/km")
  @Roles("admin", "superadmin")
  editarKmVehiculo(
    @CurrentAuth() auth: AuthPayload,
    @Param("id") id: string,
    @Body() dto: EditarKmVehiculoDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.editarKmVehiculo(auth.tenantId, id, dto.kmNuevo, auth.userId);
  }

  @ApiOperation({ summary: "Historial de correcciones manuales de km de un vehículo" })
  @Get("vehiculos/:id/km-historial")
  @Roles("admin", "member", "superadmin")
  getHistorialKmVehiculo(@CurrentAuth() auth: AuthPayload, @Param("id") id: string) {
    assertTenantId(auth.tenantId);
    return this.service.getHistorialKmVehiculo(auth.tenantId, id);
  }
}
