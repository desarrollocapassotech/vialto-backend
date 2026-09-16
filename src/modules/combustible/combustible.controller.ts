import {
  BadRequestException,
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { ClerkAuthGuard, AuthPayload } from "../../core/auth/clerk-auth.guard";
import { RolesGuard } from "../../core/auth/roles.guard";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentAuth } from "../../core/auth/current-auth.decorator";
import { CombustibleService } from "../../modules/combustible/combustible.service";
import { CreateCargaDto } from "../../modules/combustible/dto/create-carga.dto";
import { AsignarVehiculoDto } from "../../modules/combustible/dto/asignar-vehiculo.dto";
import { EditarKmVehiculoDto } from "../../modules/combustible/dto/editar-km-vehiculo.dto";

@ApiTags("Admin — Platform")
@ApiBearerAuth("clerk-jwt")
@Controller("platform/combustible")
@UseGuards(ClerkAuthGuard, RolesGuard)
// Habilitamos acceso general de lectura incluyendo roles de miembro (member / org:member)
@Roles("superadmin", "org:admin", "admin", "org:member", "member")
export class CombustibleController {
  constructor(private readonly service: CombustibleService) {}

  private requiredTenantId(
    tenantId: string | undefined,
    current: AuthPayload,
  ): string {
    const id = tenantId?.trim();
    if (!id) throw new BadRequestException("tenantId es requerido");

    // VALIDACIÓN DE SEGURIDAD (IDOR):
    // Si no es superadmin, solo puede operar sobre el tenantId al que pertenece.
    if (current.role !== "superadmin" && current.tenantId !== id) {
      throw new ForbiddenException(
        "No tenés permisos para acceder a los datos de esta empresa",
      );
    }

    return id;
  }

  /** auth sintético: el superadmin opera "como admin" del tenant elegido. */
  private scopedAuth(tenantId: string, current: AuthPayload) {
    const activeRole = current.role === "superadmin" ? "admin" : current.role;
    return { tenantId, userId: current.userId, role: activeRole };
  }

  @ApiOperation({
    summary:
      "Estaciones distintas del tenant, para el filtro (superadmin/admin/member)",
  })
  @Get("estaciones")
  getEstaciones(
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.getEstaciones(this.scopedAuth(id, current));
  }

  @ApiOperation({
    summary:
      "Listar cargas de combustible de un tenant (superadmin/admin/member)",
  })
  @Get()
  findAll(
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
    @Query("vehiculoId") vehiculoId?: string,
    @Query("choferId") choferId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("estacion") estacion?: string,
    @Query("formaPago") formaPago?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: "asc" | "desc",
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.findAll(
      this.scopedAuth(id, current),
      vehiculoId,
      choferId,
      from,
      to,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
      estacion,
      formaPago,
      sortBy,
      sortDir,
    );
  }

  @ApiOperation({
    summary: "Asignación de vehículo vigente de cada chofer (superadmin/admin/member)",
  })
  @Get("asignaciones")
  getAsignacionesActuales(
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.getAsignacionesActuales(id);
  }

  @ApiOperation({
    summary: "Historial de asignaciones de un chofer o un vehículo (superadmin/admin/member)",
  })
  @Get("asignaciones/historial")
  getHistorialAsignaciones(
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
    @Query("choferId") choferId?: string,
    @Query("vehiculoId") vehiculoId?: string,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.getHistorialAsignaciones(id, { choferId, vehiculoId });
  }

  @ApiOperation({
    summary:
      "Obtener una carga por ID dentro del tenant (superadmin/admin/member)",
  })
  @Get(":id")
  findOne(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const tid = this.requiredTenantId(tenantId, current);
    return this.service.findOne(id, this.scopedAuth(tid, current));
  }

  // --- MÉTODOS DE ESCRITURA RESTRINGIDOS EXCLUSIVAMENTE A ADMINS ---

  @ApiOperation({
    summary: "Registrar carga de combustible en un tenant (superadmin/admin)",
  })
  @Post()
  @Roles("superadmin", "org:admin", "admin")
  create(
    @Query("tenantId") tenantId: string | undefined,
    @Body() dto: CreateCargaDto,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.create(dto, this.scopedAuth(id, current));
  }

  @ApiOperation({
    summary: "Actualizar carga de combustible en un tenant (superadmin/admin)",
  })
  @Patch(":id")
  @Roles("superadmin", "org:admin", "admin")
  update(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @Body() dto: CreateCargaDto,
    @CurrentAuth() current: AuthPayload,
  ) {
    const tid = this.requiredTenantId(tenantId, current);
    return this.service.update(id, dto, this.scopedAuth(tid, current));
  }

  @ApiOperation({
    summary: "Eliminar carga de combustible de un tenant (superadmin/admin)",
  })
  @Delete(":id")
  @Roles("superadmin", "org:admin", "admin")
  remove(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const tid = this.requiredTenantId(tenantId, current);
    return this.service.remove(id, this.scopedAuth(tid, current));
  }

  @ApiOperation({
    summary: "Asignar (o reasignar) un vehículo a un chofer (superadmin/admin)",
  })
  @Post("asignaciones")
  @Roles("superadmin", "org:admin", "admin")
  asignarVehiculo(
    @Query("tenantId") tenantId: string | undefined,
    @Body() dto: AsignarVehiculoDto,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.asignarVehiculo(dto, this.scopedAuth(id, current));
  }

  @ApiOperation({
    summary:
      "Terminar la asignación activa de un chofer (superadmin/admin)",
  })
  @Delete("asignaciones/:choferId")
  @Roles("superadmin", "org:admin", "admin")
  finalizarAsignacion(
    @Param("choferId") choferId: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.finalizarAsignacion(choferId, id);
  }

  @ApiOperation({
    summary: "Corregir el kilometraje de un vehículo, con auditoría (superadmin/admin)",
  })
  @Post("vehiculos/:id/km")
  @Roles("superadmin", "org:admin", "admin")
  editarKmVehiculo(
    @Param("id") vehiculoId: string,
    @Query("tenantId") tenantId: string | undefined,
    @Body() dto: EditarKmVehiculoDto,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.editarKmVehiculo(id, vehiculoId, dto.kmNuevo, current.userId);
  }

  @ApiOperation({
    summary: "Historial de correcciones manuales de km de un vehículo (superadmin/admin/member)",
  })
  @Get("vehiculos/:id/km-historial")
  editarKmVehiculoHistorial(
    @Param("id") vehiculoId: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId, current);
    return this.service.getHistorialKmVehiculo(id, vehiculoId);
  }
}
