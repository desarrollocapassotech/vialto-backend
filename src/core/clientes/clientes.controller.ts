import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

@ApiTags('Core — Clientes')
@ApiBearerAuth('clerk-jwt')
@Controller('clientes')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @ApiOperation({ summary: 'Listar todos los clientes' })
  @Get()
  @Roles('admin', 'member', 'superadmin', 'stock_viewer')
  findAll(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar clientes paginado con búsqueda' })
  @Get('paginated')
  @Roles('admin', 'member', 'superadmin', 'stock_viewer')
  findAllPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener cliente por ID' })
  @Get(':id')
  @Roles('admin', 'member', 'superadmin', 'stock_viewer')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear cliente' })
  @Post()
  @Roles('admin', 'superadmin')
  create(@Body() dto: CreateClienteDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar datos del cliente' })
  @Patch(':id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClienteDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar cliente' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
