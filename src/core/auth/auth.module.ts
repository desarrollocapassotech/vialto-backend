import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [ClerkAuthGuard, RolesGuard],
  exports: [ClerkAuthGuard, RolesGuard],
})
export class AuthModule {}
