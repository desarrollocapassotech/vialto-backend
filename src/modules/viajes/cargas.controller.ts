import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CargasService } from './cargas.service';
import { CreateCargaDto } from './dto/create-carga.dto';
import { UpdateCargaDto } from './dto/update-carga.dto';
import { CargasPaginatedQueryDto } from './dto/cargas-paginated-query.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Módulo: Viajes — Cargas')
@ApiBearerAuth('clerk-jwt')
@Controller('cargas')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('viajes')
export class CargasController {
  constructor(private readonly service: CargasService) {}

  @ApiOperation({ summary: 'Listar cargas paginado con filtros' })
  @Get('paginated')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: CargasPaginatedQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener carga por ID' })
  @Get(':id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear carga' })
  @Post()
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateCargaDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar carga' })
  @Patch(':id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCargaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }
}
