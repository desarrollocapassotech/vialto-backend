import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ViajesService } from './viajes.service';
import { CreateViajeDto } from './dto/create-viaje.dto';
import { UpdateViajeDto } from './dto/update-viaje.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('viajes')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('viajes')
export class ViajesController {
  constructor(private readonly service: ViajesService) {}

  @Get()
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  list(@CurrentAuth() auth: AuthPayload, @Query('estado') estado?: string) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, estado);
  }

  @Get(':id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @Post()
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateViajeDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, auth, dto);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateViajeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
