import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosPaginatedQueryDto } from './dto/productos-paginated-query.dto';
import { CreatePresentacionDto } from './dto/create-presentacion.dto';
import { UpdatePresentacionDto } from './dto/update-presentacion.dto';
import { CreateMovimientoStockDto } from './dto/create-movimiento-stock.dto';
import { UpdateMovimientoStockDto } from './dto/update-movimiento-stock.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Módulo: Stock')
@ApiBearerAuth('clerk-jwt')
@Controller('stock')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  // ───────────────── PRODUCTOS ──────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar productos paginado con búsqueda y filtro' })
  @Get('productos/paginated')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findProductosPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: ProductosPaginatedQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllProductosPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener producto por ID (incluye presentaciones)' })
  @Get('productos/:id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  getProducto(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findProducto(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear producto en el catálogo' })
  @Post('productos')
  @Roles('admin', 'supervisor', 'superadmin')
  createProducto(@Body() dto: CreateProductoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createProducto(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar producto (incluye desactivar: { activo: false })' })
  @Patch('productos/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  updateProducto(
    @Param('id') id: string,
    @Body() dto: UpdateProductoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateProducto(id, auth.tenantId, dto);
  }

  // ───────────────── PRESENTACIONES ─────────────────────────────────────────

  @ApiOperation({ summary: 'Listar presentaciones de un producto' })
  @Get('productos/:productoId/presentaciones')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  listPresentaciones(
    @Param('productoId') productoId: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listPresentaciones(productoId, auth.tenantId);
  }

  @ApiOperation({ summary: 'Agregar presentación a un producto' })
  @Post('productos/:productoId/presentaciones')
  @Roles('admin', 'supervisor', 'superadmin')
  createPresentacion(
    @Param('productoId') productoId: string,
    @Body() dto: CreatePresentacionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.createPresentacion(productoId, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar presentación' })
  @Patch('productos/:productoId/presentaciones/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  updatePresentacion(
    @Param('productoId') productoId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePresentacionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updatePresentacion(productoId, id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar presentación' })
  @Delete('productos/:productoId/presentaciones/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  removePresentacion(
    @Param('productoId') productoId: string,
    @Param('id') id: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.removePresentacion(productoId, id, auth.tenantId);
  }

  // ───────────────── MOVIMIENTOS DE STOCK ───────────────────────────────────

  @ApiOperation({ summary: 'Listar movimientos de stock (filtrar por producto o cliente)' })
  @Get('movimientos')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  listMovimientos(
    @CurrentAuth() auth: AuthPayload,
    @Query('productoId') productoId?: string,
    @Query('clienteId') clienteId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listMovimientos(auth.tenantId, productoId, clienteId);
  }

  @ApiOperation({ summary: 'Obtener movimiento de stock por ID' })
  @Get('movimientos/:id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  getMovimiento(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findMovimiento(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Registrar movimiento de stock (ingreso, egreso, división)' })
  @Post('movimientos')
  @Roles('admin', 'supervisor', 'superadmin')
  createMovimiento(@Body() dto: CreateMovimientoStockDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createMovimiento(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar movimiento de stock' })
  @Patch('movimientos/:id')
  @Roles('admin', 'supervisor', 'superadmin')
  updateMovimiento(
    @Param('id') id: string,
    @Body() dto: UpdateMovimientoStockDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateMovimiento(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar movimiento de stock' })
  @Delete('movimientos/:id')
  @Roles('admin', 'superadmin')
  removeMovimiento(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removeMovimiento(id, auth.tenantId);
  }
}
