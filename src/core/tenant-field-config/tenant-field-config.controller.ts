import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantFieldConfigService } from './tenant-field-config.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Field Config — Tenant')
@ApiBearerAuth('clerk-jwt')
@Controller('field-config')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class TenantFieldConfigController {
  constructor(private readonly service: TenantFieldConfigService) {}

  @ApiOperation({ summary: 'Obtiene la configuración de campos de un módulo para el tenant actual' })
  @Get(':modulo')
  getConfigModulo(
    @Param('modulo') modulo: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getConfigEfectivaModulo(auth.tenantId, modulo);
  }
}