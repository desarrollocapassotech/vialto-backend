import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { ClerkVialtoRoleService } from './clerk-vialto-role.service';
import { RolesGuard } from './roles.guard';
import { OwnTenantOrAdminGuard } from './own-tenant-or-admin.guard';

@Global()
@Module({
  providers: [ClerkVialtoRoleService, ClerkAuthGuard, RolesGuard, OwnTenantOrAdminGuard],
  exports: [ClerkVialtoRoleService, ClerkAuthGuard, RolesGuard, OwnTenantOrAdminGuard],
})
export class AuthModule {}
