import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { OwnTenantOrAdminGuard } from '../auth/own-tenant-or-admin.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('billing')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get(':orgId')
  @UseGuards(OwnTenantOrAdminGuard)
  getSubscription(@Param('orgId') orgId: string) {
    return this.service.getSubscription(orgId);
  }

  @Put(':orgId/modules/:moduleName/activate')
  @Roles('superadmin')
  activate(@Param('orgId') orgId: string, @Param('moduleName') moduleName: string) {
    return this.service.activateModule(orgId, moduleName);
  }

  @Put(':orgId/modules/:moduleName/deactivate')
  @Roles('superadmin')
  deactivate(@Param('orgId') orgId: string, @Param('moduleName') moduleName: string) {
    return this.service.deactivateModule(orgId, moduleName);
  }
}
