import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import type { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('Sistema')
@ApiBearerAuth('clerk-jwt')
@Controller('dashboard')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: 'Resumen del dashboard del tenant (KPIs, últimos viajes, alertas)' })
  @Get('resumen')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  getResumen(@CurrentAuth() auth: AuthPayload, @Query() query: DashboardQueryDto) {
    assertTenantId(auth.tenantId);
    return this.dashboardService.getOwnerDashboard(
      auth.tenantId,
      query.period,
      query.from,
      query.to,
    );
  }
}
