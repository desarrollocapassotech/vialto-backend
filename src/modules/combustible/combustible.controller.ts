import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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

@ApiTags("Admin — Platform")
@ApiBearerAuth("clerk-jwt")
@Controller("platform/combustible")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles("superadmin")
export class CombustibleController {
  constructor(private readonly service: CombustibleService) {}

  private requiredTenantId(tenantId?: string): string {
    const id = tenantId?.trim();
    if (!id) throw new BadRequestException("tenantId es requerido");
    return id;
  }

  /** auth sintético: el superadmin opera "como admin" del tenant elegido. */
  private scopedAuth(tenantId: string, current: AuthPayload) {
    return { tenantId, userId: current.userId, role: "admin" };
  }

  @ApiOperation({
    summary: "Estaciones distintas del tenant, para el filtro (superadmin)",
  })
  @Get("estaciones")
  getEstaciones(
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId);
    return this.service.getEstaciones(this.scopedAuth(id, current));
  }

  @ApiOperation({
    summary: "Listar cargas de combustible de un tenant (superadmin)",
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
  ) {
    const id = this.requiredTenantId(tenantId);
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
    );
  }

  @ApiOperation({
    summary: "Obtener una carga por ID dentro del tenant (superadmin)",
  })
  @Get(":id")
  findOne(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const tid = this.requiredTenantId(tenantId);
    return this.service.findOne(id, this.scopedAuth(tid, current));
  }

  @ApiOperation({
    summary: "Registrar carga de combustible en un tenant (superadmin)",
  })
  @Post()
  create(
    @Query("tenantId") tenantId: string | undefined,
    @Body() dto: CreateCargaDto,
    @CurrentAuth() current: AuthPayload,
  ) {
    const id = this.requiredTenantId(tenantId);
    // El service valida que vehiculo/chofer pertenezcan a este tenantId
    // (assertVehiculoChofer) y aplica assertKmNoRetroceso sobre las cargas del tenant.
    return this.service.create(dto, this.scopedAuth(id, current));
  }

  @ApiOperation({
    summary: "Eliminar carga de combustible de un tenant (superadmin)",
  })
  @Delete(":id")
  remove(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @CurrentAuth() current: AuthPayload,
  ) {
    const tid = this.requiredTenantId(tenantId);
    return this.service.remove(id, this.scopedAuth(tid, current));
  }
}
