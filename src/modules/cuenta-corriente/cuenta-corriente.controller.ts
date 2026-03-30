import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('cuenta-corriente')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('cuenta-corriente')
export class CuentaCorrienteController {
  constructor(private readonly service: CuentaCorrienteService) {}

  @Get('movimientos')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  list(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, clienteId);
  }

  @Get('movimientos/:id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @Post('movimientos')
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateMovimientoCcDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @Patch('movimientos/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMovimientoCcDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @Delete('movimientos/:id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
