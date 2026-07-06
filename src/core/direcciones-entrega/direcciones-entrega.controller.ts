import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DireccionesEntregaService } from './direcciones-entrega.service';
import { CreateDireccionEntregaDto } from './dto/create-direccion-entrega.dto';
import { UpdateDireccionEntregaDto } from './dto/update-direccion-entrega.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

@ApiTags('Core — Direcciones de entrega')
@ApiBearerAuth('clerk-jwt')
@Controller('direcciones-entrega')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class DireccionesEntregaController {
  constructor(private readonly service: DireccionesEntregaService) {}

  @ApiOperation({ summary: 'Listar todas las direcciones/rutas de entrega' })
  @Get()
  @Roles('admin', 'member', 'superadmin')
  findAll(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar direcciones/rutas paginado' })
  @Get('paginated')
  @Roles('admin', 'member', 'superadmin')
  findAllPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener dirección/ruta por ID' })
  @Get(':id')
  @Roles('admin', 'member', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear dirección/ruta de entrega' })
  @Post()
  @Roles('admin', 'member', 'superadmin')
  create(
    @Body() dto: CreateDireccionEntregaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar dirección/ruta de entrega' })
  @Patch(':id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDireccionEntregaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar dirección/ruta de entrega' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
