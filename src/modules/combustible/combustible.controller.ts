import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { CombustibleService } from './combustible.service';
import { CreateCargaDto } from './dto/create-carga.dto';
import { UpdateCargaDto } from './dto/update-carga.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('combustible')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('combustible')
export class CombustibleController {
  constructor(private readonly service: CombustibleService) {}

  @Get('stats')
  @Roles('admin', 'supervisor', 'superadmin')
  getStats(@CurrentAuth() auth: AuthPayload, @Query('month') month?: string) {
    assertTenantId(auth.tenantId);
    return this.service.getStats(auth, month);
  }

  @Get()
  findAll(
    @CurrentAuth() auth: AuthPayload,
    @Query('vehiculoId') vehiculoId?: string,
    @Query('choferId') choferId?: string,
    @Query('month') month?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth, vehiculoId, choferId, month);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth);
  }

  @Post()
  create(@Body() dto: CreateCargaDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(dto, auth);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCargaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, dto, auth);
  }

  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth);
  }
}
