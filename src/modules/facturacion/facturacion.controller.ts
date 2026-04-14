import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { FacturacionService } from './facturacion.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { CreatePagoDto } from './dto/create-pago.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@Controller('facturacion')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('facturacion')
export class FacturacionController {
  constructor(private readonly service: FacturacionService) {}

  @Get('facturas')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  listFacturas(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listFacturas(auth.tenantId, clienteId);
  }

  @Get('facturas/:id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  getFactura(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findFactura(id, auth.tenantId);
  }

  @Post('facturas')
  @Roles('admin', 'supervisor', 'superadmin')
  createFactura(@Body() dto: CreateFacturaDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createFactura(auth.tenantId, dto);
  }

  @Patch('facturas/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  updateFactura(
    @Param('id') id: string,
    @Body() dto: UpdateFacturaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateFactura(id, auth.tenantId, dto);
  }

  @Delete('facturas/:id')
  @Roles('admin', 'superadmin')
  removeFactura(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removeFactura(id, auth.tenantId);
  }

  @Get('pagos')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  listPagos(
    @CurrentAuth() auth: AuthPayload,
    @Query('facturaId') facturaId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listPagos(auth.tenantId, facturaId);
  }

  @Post('pagos')
  @Roles('admin', 'supervisor', 'superadmin')
  createPago(@Body() dto: CreatePagoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createPago(auth.tenantId, dto);
  }

  @Delete('pagos/:id')
  @Roles('admin', 'superadmin')
  removePago(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removePago(id, auth.tenantId);
  }
}
