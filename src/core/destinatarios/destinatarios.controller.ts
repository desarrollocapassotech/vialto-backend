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
import { DestinatariosService } from './destinatarios.service';
import { CreateDestinatarioDto } from './dto/create-destinatario.dto';
import { UpdateDestinatarioDto } from './dto/update-destinatario.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

@ApiTags('Core — Destinatarios')
@ApiBearerAuth('clerk-jwt')
@Controller('destinatarios')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class DestinatariosController {
  constructor(private readonly service: DestinatariosService) {}

  @ApiOperation({ summary: 'Listar todos los destinatarios' })
  @Get()
  @Roles('admin', 'member', 'superadmin')
  findAll(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar destinatarios paginado' })
  @Get('paginated')
  @Roles('admin', 'member', 'superadmin')
  findAllPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener destinatario por ID' })
  @Get(':id')
  @Roles('admin', 'member', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear destinatario' })
  @Post()
  @Roles('admin', 'member', 'superadmin')
  create(@Body() dto: CreateDestinatarioDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar destinatario' })
  @Patch(':id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDestinatarioDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar destinatario' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
