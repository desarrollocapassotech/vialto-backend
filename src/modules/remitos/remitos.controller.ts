import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RemitosService } from './remitos.service';
import { CreateRemitoDto } from './dto/create-remito.dto';
import { UpdateRemitoDto } from './dto/update-remito.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('[Próximamente] Remitos')
@ApiBearerAuth('clerk-jwt')
@Controller('remitos')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('remitos')
export class RemitosController {
  constructor(private readonly service: RemitosService) {}

  @ApiOperation({ summary: 'Listar remitos · Fase 3 — aún no activo' })
  @Get()
  @Roles('admin', 'member', 'superadmin')
  list(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, clienteId);
  }

  @ApiOperation({ summary: 'Obtener remito por ID · Fase 3 — aún no activo' })
  @Get(':id')
  @Roles('admin', 'member', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear remito · Fase 3 — aún no activo' })
  @Post()
  @Roles('admin', 'superadmin')
  create(@Body() dto: CreateRemitoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar remito · Fase 3 — aún no activo' })
  @Patch(':id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRemitoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar remito · Fase 3 — aún no activo' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
