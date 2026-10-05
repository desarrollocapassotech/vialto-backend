import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PlanesService } from './planes.service';
import { CreatePlanMantenimientoDto } from './dto/create-plan-mantenimiento.dto';
import { UpdatePlanMantenimientoDto } from './dto/update-plan-mantenimiento.dto';
import { PlanesQueryDto } from './dto/planes-query.dto';
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
  constructor(private readonly planes: PlanesService) {}

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
}
