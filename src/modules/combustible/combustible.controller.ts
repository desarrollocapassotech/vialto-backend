import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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

@ApiTags('[Próximamente] Combustible')
@ApiBearerAuth('clerk-jwt')
@Controller('combustible')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('combustible')
export class CombustibleController {
  constructor(private readonly service: CombustibleService) {}

  @ApiOperation({ summary: 'Estadísticas de consumo de combustible · Fase 4 — aún no activo' })
  @Get('stats')
  @Roles('admin', 'supervisor', 'superadmin')
  getStats(@CurrentAuth() auth: AuthPayload, @Query('month') month?: string) {
    assertTenantId(auth.tenantId);
    return this.service.getStats(auth, month);
  }

  @ApiOperation({ summary: 'Listar cargas de combustible · Fase 4 — aún no activo' })
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

  @ApiOperation({ summary: 'Obtener carga de combustible por ID · Fase 4 — aún no activo' })
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth);
  }

  @ApiOperation({ summary: 'Registrar carga de combustible · Fase 4 — aún no activo' })
  @Post()
  create(@Body() dto: CreateCargaDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(dto, auth);
  }

  @ApiOperation({ summary: 'Actualizar carga de combustible · Fase 4 — aún no activo' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCargaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, dto, auth);
  }

  @ApiOperation({ summary: 'Eliminar carga de combustible · Fase 4 — aún no activo' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth);
  }
}
