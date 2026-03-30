import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('users')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Roles('admin', 'supervisor', 'superadmin')
  list(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.listByTenant(auth.tenantId);
  }

  @Post('invite')
  @Roles('admin', 'superadmin')
  invite(
    @CurrentAuth() auth: AuthPayload,
    @Body('email') email: string,
    @Body('role') role: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.inviteToOrg(auth.tenantId, email, role);
  }

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

  @Delete(':userId')
  @Roles('admin', 'superadmin')
  remove(@CurrentAuth() auth: AuthPayload, @Param('userId') userId: string) {
    assertTenantId(auth.tenantId);
    return this.service.removeFromOrg(auth.tenantId, userId);
  }
}
