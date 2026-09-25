import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { EstadoCuentaPdfService } from './estado-cuenta-pdf.service';
import { CreateMovimientoCcDto } from './dto/create-movimiento-cc.dto';
import { UpdateMovimientoCcDto } from './dto/update-movimiento-cc.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { ExportarMovimientosQueryDto } from './dto/exportar-movimientos-query.dto';
import { CreateImputacionCcDto } from './dto/create-imputacion-cc.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Módulo: Cuenta Corriente')
@ApiBearerAuth('clerk-jwt')
@Controller('cuenta-corriente')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('cuenta-corriente')
export class CuentaCorrienteController {
  constructor(
    private readonly service: CuentaCorrienteService,
    private readonly pdfService: EstadoCuentaPdfService,
  ) {}

  @ApiOperation({ summary: 'Listar movimientos de cuenta corriente (filtros opcionales: cliente, proveedor, estado, rango de fechas)' })
  @Get('movimientos')
  @Roles('admin', 'member', 'superadmin')
  list(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('estado') estado?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, { clienteId, proveedorId, estado, desde, hasta });
  }

  @ApiOperation({ summary: 'Tablero de cobranzas y pagos: vencidos, próximos a vencer y sin vencimiento' })
  @Get('tablero')
  @Roles('admin', 'member', 'superadmin')
  tablero(
    @CurrentAuth() auth: AuthPayload,
    @Query('diasProximos') diasProximos?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    assertTenantId(auth.tenantId);
    const dias = diasProximos ? Number(diasProximos) : undefined;
    return this.service.tablero(
      auth.tenantId,
      Number.isFinite(dias) ? dias : undefined,
      desde,
      hasta,
    );
  }

  @ApiOperation({ summary: 'Exportar movimientos a Excel' })
  @Get('movimientos/exportar')
  @Roles('admin', 'member', 'superadmin')
  exportar(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: ExportarMovimientosQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.exportarMovimientos(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Descargar el estado de cuenta en PDF de un cliente o proveedor, por período' })
  @Get('estado-cuenta/pdf')
  @Roles('admin', 'member', 'superadmin')
  async estadoCuentaPdf(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: ExportarMovimientosQueryDto,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    const { buffer, filename } = await this.pdfService.generate(auth.tenantId, query);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @ApiOperation({ summary: 'Descargar el listado completo de deudores (pendientes de cobro y de pago) en PDF' })
  @Get('listado-deudores/pdf')
  @Roles('admin', 'member', 'superadmin')
  async listadoDeudoresPdf(
    @CurrentAuth() auth: AuthPayload,
    @Query('diasProximos') diasProximos: string | undefined,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    const dias = diasProximos ? Number(diasProximos) : undefined;
    const { buffer, filename } = await this.pdfService.generateListadoDeudores(
      auth.tenantId,
      Number.isFinite(dias) ? dias : undefined,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @ApiOperation({ summary: 'Obtener movimiento por ID' })
  @Get('movimientos/:id')
  @Roles('admin', 'member', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Registrar movimiento de cuenta corriente (cliente o proveedor)' })
  @Post('movimientos')
  @Roles('admin', 'superadmin')
  create(@Body() dto: CreateMovimientoCcDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Registrar pago/cobranza (genera movimiento automáticamente)' })
  @Post('pagos')
  @Roles('admin', 'superadmin')
  registrarPago(@Body() dto: RegistrarPagoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.registrarPago(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Saldo actual de un cliente en cuenta corriente' })
  @Get('saldo/cliente/:clienteId')
  @Roles('admin', 'member', 'superadmin')
  saldoCliente(
    @Param('clienteId') clienteId: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.saldoCliente(auth.tenantId, clienteId);
  }

  @ApiOperation({ summary: 'Saldo actual de un proveedor/fletero en cuenta corriente' })
  @Get('saldo/proveedor/:proveedorId')
  @Roles('admin', 'member', 'superadmin')
  saldoProveedor(
    @Param('proveedorId') proveedorId: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.saldoProveedor(auth.tenantId, proveedorId);
  }

  @ApiOperation({ summary: 'Actualizar movimiento de cuenta corriente' })
  @Patch('movimientos/:id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMovimientoCcDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar movimiento de cuenta corriente' })
  @Delete('movimientos/:id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Imputar un pago a un cargo puntual (factura/comprobante)' })
  @Post('imputaciones')
  @Roles('admin', 'superadmin')
  crearImputacion(
    @Body() dto: CreateImputacionCcDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.crearImputacion(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Deshacer una imputación de pago a cargo' })
  @Delete('imputaciones/:id')
  @Roles('admin', 'superadmin')
  eliminarImputacion(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.eliminarImputacion(id, auth.tenantId);
  }
}
