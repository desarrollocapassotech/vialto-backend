import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { ForbiddenException } from '@nestjs/common';

@Controller('billing')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get(':orgId')
  getPlan(@Param('orgId') orgId: string, @CurrentAuth() auth: AuthPayload) {
    if (auth.role !== 'superadmin' && auth.tenantId !== orgId) {
      throw new ForbiddenException('Solo podés ver el plan de tu propio tenant');
    }
    return this.service.getPlan(orgId);
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
