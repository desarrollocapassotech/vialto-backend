import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OrdenesService } from './ordenes.service';
import { CreateOrdenTrabajoDto } from './dto/create-orden-trabajo.dto';
import { UpdateOrdenTrabajoDto } from './dto/update-orden-trabajo.dto';
import { OrdenesQueryDto } from './dto/ordenes-query.dto';
import { PlanesService } from './planes.service';
import { CreatePlanMantenimientoDto } from './dto/create-plan-mantenimiento.dto';
import { UpdatePlanMantenimientoDto } from './dto/update-plan-mantenimiento.dto';
import { PlanesQueryDto } from './dto/planes-query.dto';
import { AsignacionesService } from './asignaciones.service';
import { AsignarVehiculosDto } from './dto/asignar-vehiculos.dto';
import { UpdateVehiculoPlanDto } from './dto/update-vehiculo-plan.dto';
import { TalleresService } from './talleres.service';
import { CreateTallerDto } from './dto/create-taller.dto';
import { UpdateTallerDto } from './dto/update-taller.dto';
import { TalleresQueryDto } from './dto/talleres-query.dto';
import { ClerkAuthGuard, AuthPayload } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

/**
 * Mantenimiento de flota: planes, asignaciones, talleres, órdenes de trabajo y vencimientos
 * (ver docs/mantenimiento-plan.md). `?tenantId=` solo se honra para superadmin (vista embebida).
 */
@ApiTags('Mantenimiento')
@ApiBearerAuth('clerk-jwt')
@Controller('mantenimiento')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('mantenimiento')
export class MantenimientoController {
  constructor(
    private readonly planes: PlanesService,
    private readonly asignaciones: AsignacionesService,
    private readonly talleres: TalleresService,
    private readonly ordenes: OrdenesService,
  ) {}

  private resolveTenantId(auth: AuthPayload, overrideTenantId?: string): string {
    const tenantId =
      auth.role === 'superadmin' && overrideTenantId ? overrideTenantId : auth.tenantId;
    assertTenantId(tenantId);
    return tenantId as string;
  }

  // ── Planes ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar planes de mantenimiento (con cantidad de unidades asignadas activas)' })
  @Get('planes')
  @Roles('admin', 'member', 'superadmin')
  listPlanes(@CurrentAuth() auth: AuthPayload, @Query() query: PlanesQueryDto) {
    return this.planes.findAll(this.resolveTenantId(auth, query.tenantId), query);
  }

  @ApiOperation({
    summary: 'Cargar las plantillas sugeridas que falten',
    description:
      'Idempotente por nombre (sin distinguir mayúsculas, incluye planes inactivos). Si una plantilla fue renombrada o borrada, se vuelve a crear con el nombre original.',
  })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('planes/plantillas')
  @Roles('admin', 'superadmin')
  crearPlantillas(@CurrentAuth() auth: AuthPayload, @Query('tenantId') tenantId?: string) {
    return this.planes.crearPlantillas(this.resolveTenantId(auth, tenantId), auth.userId);
  }

  @ApiOperation({ summary: 'Obtener un plan de mantenimiento' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Get('planes/:id')
  @Roles('admin', 'member', 'superadmin')
  getPlan(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.planes.findOne(this.resolveTenantId(auth, tenantId), id);
  }

  @ApiOperation({ summary: 'Crear un plan de mantenimiento' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('planes')
  @Roles('admin', 'superadmin')
  createPlan(
    @CurrentAuth() auth: AuthPayload,
    @Body() dto: CreatePlanMantenimientoDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.planes.create(this.resolveTenantId(auth, tenantId), auth.userId, dto);
  }

  @ApiOperation({ summary: 'Editar un plan de mantenimiento (incluye activar/desactivar)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Patch('planes/:id')
  @Roles('admin', 'superadmin')
  updatePlan(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlanMantenimientoDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.planes.update(this.resolveTenantId(auth, tenantId), id, dto);
  }

  @ApiOperation({ summary: 'Borrar un plan sin unidades asignadas (si tiene, desactivarlo)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Delete('planes/:id')
  @Roles('admin', 'superadmin')
  removePlan(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.planes.remove(this.resolveTenantId(auth, tenantId), id);
  }

  // ── Asignación plan ↔ unidad ──────────────────────────────────────────────

  @ApiOperation({
    summary: 'Asignar un plan a varias unidades con su último service conocido',
    description:
      'Mandá `vehiculoIds` + `baseKm`/`baseFecha` (misma base para todas) o `vehiculos: [{ vehiculoId, baseKm, baseFecha }]` (base por unidad). Las ya asignadas activas se ignoran; las desactivadas se reactivan.',
  })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('planes/:id/vehiculos')
  @Roles('admin', 'superadmin')
  asignarVehiculos(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') planId: string,
    @Body() dto: AsignarVehiculosDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.asignaciones.asignar(this.resolveTenantId(auth, tenantId), planId, dto);
  }

  @ApiOperation({ summary: 'Unidades asignadas a un plan (activas e inactivas)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Get('planes/:id/vehiculos')
  @Roles('admin', 'member', 'superadmin')
  listarVehiculosDePlan(@CurrentAuth() auth: AuthPayload, @Param('id') planId: string, @Query('tenantId') tenantId?: string) {
    return this.asignaciones.listarPorPlan(this.resolveTenantId(auth, tenantId), planId);
  }

  @ApiOperation({ summary: 'Planes asignados a una unidad (activos e inactivos)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Get('vehiculos/:id/planes')
  @Roles('admin', 'member', 'superadmin')
  listarPlanesDeVehiculo(@CurrentAuth() auth: AuthPayload, @Param('id') vehiculoId: string, @Query('tenantId') tenantId?: string) {
    return this.asignaciones.listarPorVehiculo(this.resolveTenantId(auth, tenantId), vehiculoId);
  }

  @ApiOperation({ summary: 'Editar el último service conocido o activar/desactivar una asignación' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Patch('vehiculos-planes/:id')
  @Roles('admin', 'superadmin')
  updateAsignacion(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVehiculoPlanDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.asignaciones.update(this.resolveTenantId(auth, tenantId), id, dto);
  }

  @ApiOperation({ summary: 'Borrar una asignación que ninguna OT cumplió (si alguna la cumplió, desactivarla)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Delete('vehiculos-planes/:id')
  @Roles('admin', 'superadmin')
  removeAsignacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.asignaciones.remove(this.resolveTenantId(auth, tenantId), id);
  }

  // ── Talleres ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar talleres (con cantidad de órdenes de trabajo)' })
  @Get('talleres')
  @Roles('admin', 'member', 'superadmin')
  listTalleres(@CurrentAuth() auth: AuthPayload, @Query() query: TalleresQueryDto) {
    return this.talleres.findAll(this.resolveTenantId(auth, query.tenantId), query);
  }

  @ApiOperation({ summary: 'Obtener un taller' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Get('talleres/:id')
  @Roles('admin', 'member', 'superadmin')
  getTaller(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.talleres.findOne(this.resolveTenantId(auth, tenantId), id);
  }

  @ApiOperation({ summary: 'Crear un taller (también la alta rápida del modal de OT)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('talleres')
  @Roles('admin', 'superadmin')
  createTaller(@CurrentAuth() auth: AuthPayload, @Body() dto: CreateTallerDto, @Query('tenantId') tenantId?: string) {
    return this.talleres.create(this.resolveTenantId(auth, tenantId), dto);
  }

  @ApiOperation({ summary: 'Editar un taller (incluye activar/desactivar)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Patch('talleres/:id')
  @Roles('admin', 'superadmin')
  updateTaller(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTallerDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.talleres.update(this.resolveTenantId(auth, tenantId), id, dto);
  }

  @ApiOperation({ summary: 'Borrar un taller sin órdenes de trabajo (si tiene, desactivarlo)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Delete('talleres/:id')
  @Roles('admin', 'superadmin')
  removeTaller(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.talleres.remove(this.resolveTenantId(auth, tenantId), id);
  }

  // ── Órdenes de trabajo ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar órdenes de trabajo (paginado, con filtros)' })
  @Get('ordenes')
  @Roles('admin', 'member', 'superadmin')
  listOrdenes(@CurrentAuth() auth: AuthPayload, @Query() query: OrdenesQueryDto) {
    return this.ordenes.findAllPaginated(this.resolveTenantId(auth, query.tenantId), query);
  }

  @ApiOperation({
    summary: 'Subir un adjunto de OT (factura o foto) — devuelve la URL para mandar en `adjuntos`',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('ordenes/adjuntos')
  @Roles('admin', 'superadmin')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  subirAdjuntoOrden(
    @CurrentAuth() auth: AuthPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.ordenes.subirAdjunto(this.resolveTenantId(auth, tenantId), file);
  }

  @ApiOperation({ summary: 'Obtener una orden de trabajo con ítems, taller y planes que cumple' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Get('ordenes/:id')
  @Roles('admin', 'member', 'superadmin')
  getOrden(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.ordenes.findOne(this.resolveTenantId(auth, tenantId), id);
  }

  @ApiOperation({
    summary: 'Registrar una orden de trabajo (queda cerrada)',
    description: 'Devuelve la orden y `warning` (texto o null) si el km no cierra con las lecturas vecinas del odómetro. No bloquea.',
  })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('ordenes')
  @Roles('admin', 'superadmin')
  createOrden(@CurrentAuth() auth: AuthPayload, @Body() dto: CreateOrdenTrabajoDto, @Query('tenantId') tenantId?: string) {
    return this.ordenes.create(this.resolveTenantId(auth, tenantId), auth.userId, dto);
  }

  @ApiOperation({
    summary: 'Editar una orden de trabajo (ítems y planes, si vienen, reemplazan la lista)',
    description: 'Devuelve la orden y `warning` igual que el alta. Una orden anulada no se edita.',
  })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Patch('ordenes/:id')
  @Roles('admin', 'superadmin')
  updateOrden(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateOrdenTrabajoDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.ordenes.update(this.resolveTenantId(auth, tenantId), id, dto);
  }

  @ApiOperation({ summary: 'Anular una orden de trabajo (deja de contar para el km y los vencimientos)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Post('ordenes/:id/anular')
  @Roles('admin', 'superadmin')
  anularOrden(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.ordenes.anular(this.resolveTenantId(auth, tenantId), id);
  }

  @ApiOperation({ summary: 'Borrar una orden que no cumple planes (si cumple, anularla)' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo superadmin' })
  @Delete('ordenes/:id')
  @Roles('admin', 'superadmin')
  removeOrden(@CurrentAuth() auth: AuthPayload, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.ordenes.remove(this.resolveTenantId(auth, tenantId), id);
  }
}
