import {
  BadRequestException,
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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

@ApiTags('Módulo: Facturación')
@ApiBearerAuth('clerk-jwt')
@Controller('facturacion')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('facturacion')
export class FacturacionController {
  constructor(private readonly service: FacturacionService) {}

  @ApiOperation({ summary: 'Listar facturas (opcionalmente filtrar por cliente)' })
  @Get('facturas')
  @Roles('admin', 'member', 'superadmin')
  listFacturas(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listFacturas(auth.tenantId, clienteId);
  }

  @ApiOperation({ summary: 'Obtener factura por ID' })
  @Get('facturas/:id')
  @Roles('admin', 'member', 'superadmin')
  getFactura(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findFactura(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear factura' })
  @Post('facturas')
  @Roles('admin', 'superadmin')
  createFactura(@Body() dto: CreateFacturaDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createFactura(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar factura (estado, vencimiento)' })
  @Patch('facturas/:id')
  @Roles('admin', 'superadmin')
  updateFactura(
    @Param('id') id: string,
    @Body() dto: UpdateFacturaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateFactura(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar factura' })
  @Delete('facturas/:id')
  @Roles('admin', 'superadmin')
  removeFactura(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removeFactura(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar pagos (opcionalmente filtrar por factura)' })
  @Get('pagos')
  @Roles('admin', 'member', 'superadmin')
  listPagos(
    @CurrentAuth() auth: AuthPayload,
    @Query('facturaId') facturaId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listPagos(auth.tenantId, facturaId);
  }

  @ApiOperation({ summary: 'Registrar pago sobre una factura' })
  @Post('pagos')
  @Roles('admin', 'superadmin')
  createPago(@Body() dto: CreatePagoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createPago(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar pago' })
  @Delete('pagos/:id')
  @Roles('admin', 'superadmin')
  removePago(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removePago(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Subir comprobante adjunto (PDF o imagen) a Cloudinary' })
  @Post('upload-comprobante')
  @Roles('admin', 'member', 'superadmin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadComprobante(
    @UploadedFile() file: Express.Multer.File,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    if (!file) throw new BadRequestException('Se requiere un archivo.');
    return this.service.uploadComprobante(auth.tenantId, file);
  }
}
