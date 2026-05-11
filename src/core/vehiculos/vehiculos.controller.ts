import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VehiculosService } from './vehiculos.service';
import { CreateVehiculoDto } from './dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from './dto/update-vehiculo.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

@ApiTags('Core — Vehículos')
@ApiBearerAuth('clerk-jwt')
@Controller('vehiculos')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class VehiculosController {
  constructor(private readonly service: VehiculosService) {}

  @ApiOperation({ summary: 'Listar todos los vehículos' })
  @Get()
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findAll(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar vehículos paginado con búsqueda' })
  @Get('paginated')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findAllPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener vehículo por ID' })
  @Get(':id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Registrar vehículo' })
  @Post()
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateVehiculoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar datos del vehículo' })
  @Patch(':id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVehiculoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar vehículo' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
