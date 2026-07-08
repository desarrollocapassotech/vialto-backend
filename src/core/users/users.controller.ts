import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Core — Usuarios')
@ApiBearerAuth('clerk-jwt')
@Controller('users')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @ApiOperation({ summary: 'Listar usuarios de la organización' })
  @Get()
  @Roles('admin', 'superadmin', 'stock_viewer')
  list(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.listByTenant(auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear usuario en la organización' })
  @Post()
  @Roles('admin', 'superadmin')
  create(
    @CurrentAuth() auth: AuthPayload,
    @Body('name') name: string,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('role') role: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, name, email, password, role);
  }

  @ApiOperation({ summary: 'Cambiar rol de un usuario' })
  @Patch(':userId/role')
  @Roles('admin', 'superadmin')
  updateRole(
    @CurrentAuth() auth: AuthPayload,
    @Param('userId') userId: string,
    @Body('role') role: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateRole(auth.tenantId, userId, role);
  }

  @ApiOperation({ summary: 'Eliminar usuario de la organización' })
  @Delete(':userId')
  @Roles('admin', 'superadmin')
  remove(@CurrentAuth() auth: AuthPayload, @Param('userId') userId: string) {
    assertTenantId(auth.tenantId);
    return this.service.removeFromOrg(auth.tenantId, userId);
  }
}
