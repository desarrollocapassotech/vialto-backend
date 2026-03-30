import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlatformService } from './platform.service';

/**
 * Datos por tenant (query `tenantId` = clerkOrgId) — solo superadmin.
 * Sin `tenantId` la respuesta es lista vacía.
 */
@Controller('platform')
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles('superadmin')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Get('viajes')
  viajes(@Query('tenantId') tenantId?: string) {
    return this.service.listViajes(tenantId);
  }

  @Get('clientes')
  clientes(@Query('tenantId') tenantId?: string) {
    return this.service.listClientes(tenantId);
  }

  @Get('choferes')
  choferes(@Query('tenantId') tenantId?: string) {
    return this.service.listChoferes(tenantId);
  }

  @Get('vehiculos')
  vehiculos(@Query('tenantId') tenantId?: string) {
    return this.service.listVehiculos(tenantId);
  }
}
