import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaisesService } from './paises.service';
import { CreatePaisDto } from './dto/create-pais.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Core — Países')
@ApiBearerAuth('clerk-jwt')
@Controller('paises')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class PaisesController {
  constructor(private readonly service: PaisesService) {}

  @ApiOperation({ summary: 'Listar países del tenant' })
  @Get()
  @Roles('admin', 'member', 'superadmin')
  findAll(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId);
  }

  @ApiOperation({
    summary: 'Crear país al vuelo (creación rápida desde el desplegable)',
  })
  @Post()
  @Roles('admin', 'member', 'superadmin')
  create(@Body() dto: CreatePaisDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto, auth.userId);
  }
}