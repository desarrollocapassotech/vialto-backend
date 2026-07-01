import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StockService } from './stock.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosPaginatedQueryDto } from './dto/productos-paginated-query.dto';
import { CreateDepositoDto } from './dto/create-deposito.dto';
import { UpdateDepositoDto } from './dto/update-deposito.dto';
import { CreateMovimientoStockDto } from './dto/create-movimiento-stock.dto';
import { UpdateMovimientoStockDto } from './dto/update-movimiento-stock.dto';
import { CreateIngresoDto } from './dto/create-ingreso.dto';
import { CreateEgresoDto } from './dto/create-egreso.dto';
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateStockEgresoRemitoConfigDto } from './dto/update-stock-egreso-remito-config.dto';
import { CreatePresentacionDto } from './dto/create-presentacion.dto';
import { UpdatePresentacionDto } from './dto/update-presentacion.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PaginationQueryDto } from 'shared/dto/pagination-query.dto';

@ApiTags('Módulo: Stock')
@ApiBearerAuth('clerk-jwt')
@Controller('stock')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  // ───────────────── PRODUCTOS ──────────────────────────────────────────────
  // Los endpoints de CRUD de productos se habilitan con stock O viajes,
  // ya que los tenants con viajes también gestionan un catálogo de productos.

  @ApiOperation({ summary: 'Listar productos paginado con búsqueda y filtro' })
  @Get('productos/paginated')
  @RequireModule('stock', 'viajes')
  @Roles('admin', 'member', 'superadmin')
  findProductosPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: ProductosPaginatedQueryDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAllProductosPaginated(auth.tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener producto por ID' })
  @Get('productos/:id')
  @RequireModule('stock', 'viajes')
  @Roles('admin', 'member', 'superadmin')
  getProducto(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findProducto(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear producto en el catálogo' })
  @Post('productos')
  @RequireModule('stock', 'viajes')
  @Roles('admin', 'superadmin')
  createProducto(@Body() dto: CreateProductoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createProducto(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar producto (incluye desactivar: { activo: false })' })
  @Patch('productos/:id')
  @RequireModule('stock', 'viajes')
  @Roles('admin', 'superadmin')
  updateProducto(
    @Param('id') id: string,
    @Body() dto: UpdateProductoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateProducto(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar presentación de un producto (solo si sin movimientos)' })
  @Delete('productos/:productoId/presentaciones/:ppId')
  @RequireModule('stock', 'viajes')
  @Roles('admin', 'superadmin')
  removeProductoPresentacion(
    @Param('productoId') productoId: string,
    @Param('ppId') ppId: string,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.removeProductoPresentacion(productoId, ppId, auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar presentaciones del catálogo' })
  @Get('presentaciones')
  @Roles('admin', 'member', 'superadmin')
  listPresentaciones(
    @CurrentAuth() auth: AuthPayload,
    @Query('activo') activo?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listPresentaciones(
      auth.tenantId,
      activo === '0' ? false : activo === '1' ? true : undefined,
    );
  }

  @ApiOperation({ summary: 'Crear presentación en el catálogo' })
  @Post('presentaciones')
  @Roles('admin', 'superadmin')
  createPresentacion(@Body() dto: CreatePresentacionDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createPresentacion(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar presentación del catálogo' })
  @Patch('presentaciones/:id')
  @Roles('admin', 'superadmin')
  updatePresentacion(
    @Param('id') id: string,
    @Body() dto: UpdatePresentacionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updatePresentacion(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Eliminar presentación del catálogo' })
  @Delete('presentaciones/:id')
  @Roles('admin', 'superadmin')
  removePresentacion(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removePresentacion(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar depósitos' })
  @Get('depositos')
  @Roles('admin', 'member', 'superadmin')
  listDepositos(@CurrentAuth() auth: AuthPayload, @Query('activo') activo?: string) {
    assertTenantId(auth.tenantId);
    return this.service.listDepositos(
      auth.tenantId,
      activo === '0' ? false : activo === '1' ? true : undefined,
    );
  }

  @ApiOperation({ summary: 'Crear depósito' })
  @Post('depositos')
  @Roles('admin', 'superadmin')
  createDeposito(@Body() dto: CreateDepositoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createDeposito(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar depósito' })
  @Patch('depositos/:id')
  @Roles('admin', 'superadmin')
  updateDeposito(
    @Param('id') id: string,
    @Body() dto: UpdateDepositoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateDeposito(id, auth.tenantId, dto);
  }

  // ───────────────── OPERACIONES DE STOCK (cabecera consolidada) ────────────

  @ApiOperation({
    summary:
      'Listar operaciones de stock (ingreso/egreso/división) paginadas — una cabecera por comprobante con todas sus líneas.',
  })
  @Get('operaciones/paginated')
  @Roles('admin', 'superadmin')
  listOperacionesPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
    @Query('productoId') productoId?: string,
    @Query('clienteId') clienteId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('tipo') tipo?: 'ingreso' | 'egreso' | 'division',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('createdBy') createdBy?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listOperacionesPaginated(auth.tenantId, query, productoId, clienteId, {
      depositoId,
      tipo,
      fechaDesde,
      fechaHasta,
      createdBy,
    });
  }

  @ApiOperation({ summary: 'Obtener operación de stock por ID (cabecera + líneas + adjuntos)' })
  @Get('operaciones/:id')
  @Roles('admin', 'superadmin')
  getOperacion(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOperacion(id, auth.tenantId);
  }

  // ───────────────── MOVIMIENTOS DE STOCK (líneas / legacy) ───────────────────

  @ApiOperation({ summary: 'Listar movimientos de stock con filtros opcionales (producto, cliente, depósito, tipo, fechas, usuario).' })
  @Get('movimientos')
  @Roles('admin', 'superadmin')
  listMovimientos(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: PaginationQueryDto,
    @Query('productoId') productoId?: string,
    @Query('clienteId') clienteId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('tipo') tipo?: 'ingreso' | 'egreso' | 'division',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('createdBy') createdBy?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listMovimientos(auth.tenantId, query, productoId, clienteId, {
      depositoId,
      tipo,
      fechaDesde,
      fechaHasta,
      createdBy,
    });
  }

  @ApiOperation({ summary: 'Obtener movimiento de stock por ID' })
  @Get('movimientos/:id')
  @Roles('admin', 'superadmin')
  getMovimiento(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findMovimiento(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Descargar / previsualizar remito PDF del egreso' })
  @Get('movimientos/:id/remito-adjunto')
  @Roles('admin', 'member', 'superadmin')
  async getRemitoAdjunto(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthPayload,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    await this.service.streamRemitoAdjunto(id, auth.tenantId, res);
  }

  @ApiOperation({ summary: 'Registrar movimiento de stock (ingreso, egreso, división)' })
  @Post('movimientos')
  @Roles('admin', 'superadmin')
  createMovimiento(@Body() dto: CreateMovimientoStockDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createMovimiento(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar movimiento de stock' })
  @Patch('movimientos/:id')
  @Roles('admin', 'superadmin')
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

  @ApiOperation({ summary: 'Subir foto del producto para ingreso' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('upload-foto-ingreso')
  @Roles('admin', 'member', 'superadmin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadFotoIngreso(@UploadedFile() file: Express.Multer.File, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    return this.service.uploadIngresoFoto(auth.tenantId, file);
  }

  @ApiOperation({ summary: 'Subir foto del producto (alias legacy)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('upload-remito')
  @Roles('admin', 'member', 'superadmin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadRemito(@UploadedFile() file: Express.Multer.File, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    return this.service.uploadIngresoFoto(auth.tenantId, file);
  }

  // ───────────────── EGRESOS (DESPACHO) ─────────────────────────────────────

  @ApiOperation({ summary: 'Formato del número de remito en egresos (prefijo y dígitos)' })
  @Get('egresos/remito-config')
  @Roles('admin', 'member', 'superadmin')
  getEgresoRemitoConfig(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getEgresoRemitoConfig(auth.tenantId);
  }

  @ApiOperation({ summary: 'Actualizar formato del número de remito en egresos' })
  @Patch('egresos/remito-config')
  @Roles('admin', 'superadmin')
  patchEgresoRemitoConfig(
    @Body() dto: UpdateStockEgresoRemitoConfigDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.upsertEgresoRemitoConfig(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Registrar egreso / despacho (descuenta stock y asigna número de remito)' })
  @Post('egresos')
  @Roles('admin', 'member', 'superadmin')
  createEgreso(@Body() dto: CreateEgresoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createEgreso(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar egresos recientes' })
  @Get('egresos')
  @Roles('admin', 'member', 'superadmin')
  listEgresos(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listEgresos(auth.tenantId, clienteId, productoId, depositoId, fechaDesde, fechaHasta);
  }

  @ApiOperation({ summary: 'Obtener egreso por ID (remito interno)' })
  @Get('egresos/:id')
  @Roles('admin', 'member', 'superadmin')
  getEgreso(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findEgreso(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Visualizar remito interno en PDF (inline, sin descarga)' })
  @Get('egresos/:id/remito-interno/view')
  @Roles('admin', 'member', 'superadmin')
  async viewRemitoInterno(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthPayload,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    await this.service.streamRemitoInternoView(id, auth.tenantId, res);
  }

  @ApiOperation({ summary: 'Generar (si falta) y obtener URL del remito interno en PDF' })
  @Post('egresos/:id/remito-interno')
  @Roles('admin', 'member', 'superadmin')
  ensureRemitoInterno(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.ensureRemitoInternoPdf(id, auth.tenantId);
  }

  // ───────────────── INGRESOS AL DEPÓSITO ───────────────────────────────────

  @ApiOperation({ summary: 'Registrar ingreso de mercadería al depósito (actualiza stock)' })
  @Post('ingresos')
  @Roles('admin', 'member', 'superadmin')
  createIngreso(@Body() dto: CreateIngresoDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createIngreso(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar ingresos al depósito' })
  @Get('ingresos')
  @Roles('admin', 'member', 'superadmin')
  listIngresos(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listIngresos(auth.tenantId, clienteId, productoId, depositoId, fechaDesde, fechaHasta);
  }

  // ───────────────── DIVISIONES ─────────────────────────────────────────────

  @ApiOperation({ summary: 'Registrar división de bultos (convierte pallets ↔ suelto, actualiza stock)' })
  @Post('divisiones')
  @Roles('admin', 'superadmin')
  createDivision(@Body() dto: CreateDivisionDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.createDivision(auth.tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar divisiones de bultos' })
  @Get('divisiones')
  @Roles('admin', 'superadmin')
  listDivisiones(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
    @Query('depositoId') depositoId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listDivisiones(auth.tenantId, clienteId, productoId, depositoId);
  }

  @ApiOperation({ summary: 'Lotes históricos ingresados (para autocompletado)' })
  @Get('lotes/historico')
  @Roles('admin', 'superadmin')
  getLotesHistorico(
    @CurrentAuth() auth: AuthPayload,
    @Query('productoId') productoId: string,
    @Query('clienteId') clienteId: string,
    @Query('depositoId') depositoId: string,
    @Query('presentacionId') presentacionId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getLotesHistorico(auth.tenantId, productoId, clienteId, depositoId, presentacionId);
  }

  @ApiOperation({ summary: 'Lotes disponibles para un producto/cliente/depósito' })
  @Get('lotes')
  @Roles('admin', 'superadmin')
  getLotes(
    @CurrentAuth() auth: AuthPayload,
    @Query('productoId') productoId: string,
    @Query('clienteId') clienteId: string,
    @Query('depositoId') depositoId: string,
    @Query('presentacionId') presentacionId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.getLotesDisponibles(auth.tenantId, productoId, clienteId, depositoId, presentacionId);
  }

  @ApiOperation({ summary: 'Stock disponible por producto/cliente' })
  @Get('disponible')
  @Roles('admin', 'superadmin')
  listStockDisponible(
    @CurrentAuth() auth: AuthPayload,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.listStockDisponible(auth.tenantId, clienteId, productoId);
  }
}
