import { Controller, Get, UseGuards } from '@nestjs/common';
import { ReportesService } from './reportes.service';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('reportes')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('reportes')
export class ReportesController {
  constructor(private readonly service: ReportesService) {}

  @Get('resumen')
  @Roles('admin', 'supervisor', 'superadmin')
  resumen(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.resumen(auth.tenantId);
  }
}
