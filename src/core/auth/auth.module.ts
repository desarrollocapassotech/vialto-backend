import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { ClerkVialtoRoleService } from './clerk-vialto-role.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [ClerkVialtoRoleService, ClerkAuthGuard, RolesGuard],
  exports: [ClerkVialtoRoleService, ClerkAuthGuard, RolesGuard],
})
export class AuthModule {}
