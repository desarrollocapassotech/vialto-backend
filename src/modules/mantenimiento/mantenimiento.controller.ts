import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { MantenimientoService } from './mantenimiento.service';
import { CreateIntervencionDto } from './dto/create-intervencion.dto';
import { UpdateIntervencionDto } from './dto/update-intervencion.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('mantenimiento')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('mantenimiento')
export class MantenimientoController {
  constructor(private readonly service: MantenimientoService) {}

  @Get('intervenciones')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  list(
    @CurrentAuth() auth: AuthPayload,
    @Query('vehiculoId') vehiculoId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, vehiculoId);
  }

  @Get('intervenciones/:id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @Post('intervenciones')
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateIntervencionDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @Patch('intervenciones/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntervencionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @Delete('intervenciones/:id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
