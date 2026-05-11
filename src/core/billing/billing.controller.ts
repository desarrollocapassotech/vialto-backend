import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { OwnTenantOrAdminGuard } from '../auth/own-tenant-or-admin.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Admin — Billing')
@ApiBearerAuth('clerk-jwt')
@Controller('billing')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @ApiOperation({ summary: 'Obtener suscripción y módulos activos del tenant' })
  @Get(':orgId')
  @UseGuards(OwnTenantOrAdminGuard)
  getSubscription(@Param('orgId') orgId: string) {
    return this.service.getSubscription(orgId);
  }

  @ApiOperation({ summary: 'Activar módulo para un tenant' })
  @Put(':orgId/modules/:moduleName/activate')
  @Roles('superadmin')
  activate(@Param('orgId') orgId: string, @Param('moduleName') moduleName: string) {
    return this.service.activateModule(orgId, moduleName);
  }

  @ApiOperation({ summary: 'Desactivar módulo de un tenant' })
  @Put(':orgId/modules/:moduleName/deactivate')
  @Roles('superadmin')
  deactivate(@Param('orgId') orgId: string, @Param('moduleName') moduleName: string) {
    return this.service.deactivateModule(orgId, moduleName);
  }
}
