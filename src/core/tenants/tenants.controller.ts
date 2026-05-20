import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { OwnTenantOrAdminGuard } from '../auth/own-tenant-or-admin.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';

@ApiTags('Admin — Tenants')
@ApiBearerAuth('clerk-jwt')
@Controller('tenants')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @ApiOperation({ summary: 'Listar todas las empresas (tenants)' })
  @Get()
  @Roles('superadmin')
  findAll() {
    return this.service.findAll();
  }

  @ApiOperation({ summary: 'Listar tenants paginado con filtros' })
  @Get('paginated')
  @Roles('superadmin')
  findAllPaginated(@Query() query: ListTenantsDto) {
    return this.service.findAllPaginated(query);
  }

  @ApiOperation({ summary: 'Obtener tenant por orgId' })
  @Get(':orgId')
  @UseGuards(OwnTenantOrAdminGuard)
  findOne(@Param('orgId') orgId: string) {
    return this.service.findOne(orgId);
  }

  @ApiOperation({ summary: 'Registrar org de Clerk en Vialto si aún no existe' })
  @Post(':orgId/ensure')
  @UseGuards(OwnTenantOrAdminGuard)
  ensure(@Param('orgId') orgId: string) {
    return this.service.ensureRegistered(orgId);
  }

  @ApiOperation({ summary: 'Crear nuevo tenant (empresa cliente)' })
  @Post()
  @Roles('superadmin')
  create(@Body() dto: CreateTenantDto, @CurrentAuth() auth: AuthPayload) {
    return this.service.create(dto, auth.userId);
  }

  @ApiOperation({ summary: 'Actualizar datos del tenant' })
  @Patch(':orgId')
  @Roles('superadmin')
  update(@Param('orgId') orgId: string, @Body() dto: UpdateTenantDto) {
    return this.service.update(orgId, dto);
  }

  @ApiOperation({ summary: 'Reemplazar lista de módulos activos del tenant' })
  @Put(':orgId/modules')
  @Roles('superadmin')
  setModules(@Param('orgId') orgId: string, @Body('modules') modules: string[]) {
    return this.service.setModules(orgId, modules);
  }

  @ApiOperation({ summary: 'Eliminar tenant' })
  @Delete(':orgId')
  @Roles('superadmin')
  remove(@Param('orgId') orgId: string) {
    return this.service.remove(orgId);
  }
}
