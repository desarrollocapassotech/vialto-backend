import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlatformService } from './platform.service';
import { CreateClienteDto } from '../clientes/dto/create-cliente.dto';
import { UpdateClienteDto } from '../clientes/dto/update-cliente.dto';
import { CreateChoferDto } from '../choferes/dto/create-chofer.dto';
import { UpdateChoferDto } from '../choferes/dto/update-chofer.dto';
import { CreateVehiculoDto } from '../vehiculos/dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from '../vehiculos/dto/update-vehiculo.dto';
import { CreateTransportistaDto } from '../transportistas/dto/create-transportista.dto';
import { UpdateTransportistaDto } from '../transportistas/dto/update-transportista.dto';
import { CreateViajeDto } from '../../modules/viajes/dto/create-viaje.dto';
import { UpdateViajeDto } from '../../modules/viajes/dto/update-viaje.dto';
import { MicCrtExportDto } from '../../modules/viajes/dto/mic-crt-export.dto';
import { ProductosPaginatedQueryDto } from '../../modules/stock/dto/productos-paginated-query.dto';
import { CreateProductoDto } from '../../modules/stock/dto/create-producto.dto';
import { UpdateProductoDto } from '../../modules/stock/dto/update-producto.dto';
import { CreatePresentacionDto } from '../../modules/stock/dto/create-presentacion.dto';
import { UpdatePresentacionDto } from '../../modules/stock/dto/update-presentacion.dto';
import { CreateIngresoDto } from '../../modules/stock/dto/create-ingreso.dto';
import { CreateEgresoDto } from '../../modules/stock/dto/create-egreso.dto';
import { CreateDivisionDto } from '../../modules/stock/dto/create-division.dto';
import { UpdateStockEgresoRemitoConfigDto } from '../../modules/stock/dto/update-stock-egreso-remito-config.dto';
import { ViajesPaginatedQueryDto } from '../../modules/viajes/dto/viajes-paginated-query.dto';
import { parseViajesSortParams, parseFechaFiltroQuery, parseTipoFechaQuery } from '../../modules/viajes/viajes-paginated-query.util';
import { AddGastoDto } from '../../modules/viajes/dto/add-gasto.dto';
import { AddPagoTransportistaDto } from '../../modules/viajes/dto/add-pago-transportista.dto';
import { CreateFacturaDto } from '../../modules/facturacion/dto/create-factura.dto';
import { UpdateFacturaDto } from '../../modules/facturacion/dto/update-factura.dto';
import { CreatePagoDto } from '../../modules/facturacion/dto/create-pago.dto';
import { queryParamFromRequest } from '../../shared/util/express-query-string';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';

/**
 * Datos por tenant (query `tenantId` = clerkOrgId) — solo superadmin.
 * Sin `tenantId` la respuesta es lista vacía.
 */
@ApiTags('Admin — Platform')
@ApiBearerAuth('clerk-jwt')
@Controller('platform')
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles('superadmin')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Get('viajes/paginated')
  viajesPaginated(
    @Query('tenantId') tenantId: string | undefined,
    @Query() query: ViajesPaginatedQueryDto,
    @Req() req: Request,
  ) {
    const clienteId = queryParamFromRequest(req, 'clienteId') ?? query.clienteId;
    const transportistaId = queryParamFromRequest(req, 'transportistaId') ?? query.transportistaId;
    const tipoUbicacionRaw = queryParamFromRequest(req, 'tipoUbicacion') ?? query.tipoUbicacion;
    const tipoUbicacion =
      tipoUbicacionRaw === 'origen' || tipoUbicacionRaw === 'destino' ? tipoUbicacionRaw : undefined;
    const ubicacion = queryParamFromRequest(req, 'ubicacion') ?? query.ubicacion;
    const tipoFecha = parseTipoFechaQuery(
      queryParamFromRequest(req, 'tipoFecha') ?? query.tipoFecha,
    );
    const fechaDesde = parseFechaFiltroQuery(
      queryParamFromRequest(req, 'fechaDesde') ?? query.fechaDesde,
    );
    const fechaHasta = parseFechaFiltroQuery(
      queryParamFromRequest(req, 'fechaHasta') ?? query.fechaHasta,
    );
    const sort = parseViajesSortParams(
      queryParamFromRequest(req, 'sortBy') ?? query.sortBy,
      queryParamFromRequest(req, 'sortDir') ?? query.sortDir,
    );
    return this.service.viajesPaginated(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      estado: query.estado,
      clienteId,
      transportistaId,
      tipoFecha,
      fechaDesde,
      fechaHasta,
      tipoUbicacion,
      ubicacion,
      sortBy: sort.sortBy,
      sortDir: sort.sortDir,
    });
  }

  @Get('viajes')
  viajes(@Query('tenantId') tenantId?: string) {
    return this.service.listViajes(tenantId);
  }

  @Get('viajes/:id/documento-aduanero')
  viajeDocumentoAduanero(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    return this.service.micCrtPrefill(tenantId, id);
  }

  @Post('viajes/:id/mic-crt')
  async viajeMicCrt(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: MicCrtExportDto,
    @Res() res: Response,
  ) {
    try {
      const pdf = await this.service.micCrtPdf(tenantId, id, dto);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="MIC-CRT-${id}.pdf"`,
        'Content-Length': String(pdf.length),
      });
      res.end(pdf);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string; response?: unknown };
      if (e?.status === 400 || e?.status === 404) {
        res.status(e.status).json(e.response ?? { message: e.message });
      } else {
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @Get('viajes/:id/exportaciones')
  viajeExportaciones(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    return this.service.viajeExportaciones(tenantId, id);
  }

  @Get('viajes/:id/paut')
  async viajePaut(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const pdf = await this.service.pautPdf(tenantId, id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PAUT-${id}.pdf"`,
        'Content-Length': String(pdf.length),
      });
      res.end(pdf);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string; response?: unknown };
      if (e?.status === 400 || e?.status === 404) {
        res.status(e.status).json(e.response ?? { message: e.message });
      } else {
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @Get('viajes/:id')
  viajeById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getViajeById(tenantId, id);
  }

  @Post('viajes')
  createViaje(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateViajeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createViaje(tenantId, dto, auth.userId);
  }

  @Patch('viajes/:id')
  updateViaje(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateViajeDto,
  ) {
    return this.service.updateViaje(tenantId, id, dto);
  }

  @Delete('viajes/:id')
  removeViaje(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeViaje(tenantId, id);
  }

  @Post('viajes/:id/gastos')
  addViajeGasto(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: AddGastoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.addViajeGasto(tenantId, id, auth.userId, dto);
  }

  @Post('viajes/:id/pagos-transportista')
  addViajePagoTransportista(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: AddPagoTransportistaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.addViajePagoTransportista(tenantId, id, auth.userId, dto);
  }

  @Delete('viajes/:id/pagos-transportista/:index')
  deleteViajePagoTransportista(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.deleteViajePagoTransportista(tenantId, id, auth.userId, index);
  }

  @Get('clientes')
  clientes(@Query('tenantId') tenantId?: string) {
    return this.service.listClientes(tenantId);
  }

  @Get('clientes/:id')
  clienteById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getClienteById(tenantId, id);
  }

  @Post('clientes')
  createCliente(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateClienteDto,
  ) {
    return this.service.createCliente(tenantId, dto);
  }

  @Patch('clientes/:id')
  updateCliente(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateClienteDto,
  ) {
    return this.service.updateCliente(tenantId, id, dto);
  }

  @Delete('clientes/:id')
  removeCliente(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeCliente(tenantId, id);
  }

  @Get('choferes')
  choferes(@Query('tenantId') tenantId?: string) {
    return this.service.listChoferes(tenantId);
  }

  @Get('choferes/:id')
  choferById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getChoferById(tenantId, id);
  }

  @Post('choferes')
  createChofer(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateChoferDto,
  ) {
    return this.service.createChofer(tenantId, dto);
  }

  @Patch('choferes/:id')
  updateChofer(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateChoferDto,
  ) {
    return this.service.updateChofer(tenantId, id, dto);
  }

  @Delete('choferes/:id')
  removeChofer(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeChofer(tenantId, id);
  }

  @Get('vehiculos')
  vehiculos(@Query('tenantId') tenantId?: string) {
    return this.service.listVehiculos(tenantId);
  }

  @Get('transportistas')
  transportistas(@Query('tenantId') tenantId?: string) {
    return this.service.listTransportistas(tenantId);
  }

  @Get('transportistas/:id')
  transportistaById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getTransportistaById(tenantId, id);
  }

  @Post('transportistas')
  createTransportista(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateTransportistaDto,
  ) {
    return this.service.createTransportista(tenantId, dto);
  }

  @Patch('transportistas/:id')
  updateTransportista(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateTransportistaDto,
  ) {
    return this.service.updateTransportista(tenantId, id, dto);
  }

  @Delete('transportistas/:id')
  removeTransportista(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeTransportista(tenantId, id);
  }

  @Get('users')
  users(@Query('tenantId') tenantId?: string) {
    return this.service.listUsers(tenantId);
  }

  @Get('users/:userId')
  userById(@Param('userId') userId: string, @Query('tenantId') tenantId?: string) {
    return this.service.getUserById(tenantId, userId);
  }

  @Post('users/invite')
  inviteUser(
    @Query('tenantId') tenantId: string | undefined,
    @Body('name') name: string,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('role') role: string,
  ) {
    return this.service.inviteUser(tenantId, name, email, password, role);
  }

  @Patch('users/:userId/role')
  updateUserRole(
    @Param('userId') userId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body('role') role: string,
  ) {
    return this.service.updateUserRole(tenantId, userId, role);
  }

  @Delete('users/:userId')
  removeUser(@Param('userId') userId: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeUser(tenantId, userId);
  }

  @Get('vehiculos/:id')
  vehiculoById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getVehiculoById(tenantId, id);
  }

  @Post('vehiculos')
  createVehiculo(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateVehiculoDto,
  ) {
    return this.service.createVehiculo(tenantId, dto);
  }

  @Patch('vehiculos/:id')
  updateVehiculo(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateVehiculoDto,
  ) {
    return this.service.updateVehiculo(tenantId, id, dto);
  }

  @Delete('vehiculos/:id')
  removeVehiculo(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeVehiculo(tenantId, id);
  }

  // ── Facturación ────────────────────────────────────────────────────────────

  @Get('facturas')
  facturas(@Query('tenantId') tenantId?: string, @Query('clienteId') clienteId?: string) {
    return this.service.listFacturas(tenantId, clienteId);
  }

  @Post('facturas')
  createFactura(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateFacturaDto,
  ) {
    return this.service.createFactura(tenantId ?? '', dto);
  }

  @Delete('facturas/:id')
  removeFactura(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeFactura(tenantId, id);
  }

  @Patch('facturas/:id')
  updateFactura(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateFacturaDto,
  ) {
    return this.service.updateFactura(tenantId, id, dto);
  }

  @Post('pagos')
  createPago(@Query('tenantId') tenantId: string | undefined, @Body() dto: CreatePagoDto) {
    return this.service.createPago(tenantId, dto);
  }

  @Delete('pagos/:id')
  deletePago(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.deletePago(tenantId, id);
  }

  // ─── Productos (módulo stock) ────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar productos paginado (superadmin)' })
  @Get('stock/productos/paginated')
  productosPaginated(
    @Query('tenantId') tenantId: string | undefined,
    @Query() query: ProductosPaginatedQueryDto,
  ) {
    return this.service.listProductosPaginated(tenantId, query);
  }

  @ApiOperation({ summary: 'Obtener producto por ID (superadmin)' })
  @Get('stock/productos/:id')
  productoById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getProducto(tenantId, id);
  }

  @ApiOperation({ summary: 'Crear producto (superadmin)' })
  @Post('stock/productos')
  createProducto(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateProductoDto,
  ) {
    return this.service.createProducto(tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar producto (superadmin)' })
  @Patch('stock/productos/:id')
  updateProducto(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateProductoDto,
  ) {
    return this.service.updateProducto(tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Listar presentaciones del catálogo (superadmin)' })
  @Get('stock/presentaciones')
  listPresentaciones(
    @Query('tenantId') tenantId?: string,
    @Query('activo') activo?: string,
  ) {
    return this.service.listPresentaciones(
      tenantId,
      activo === '0' ? false : activo === '1' ? true : undefined,
    );
  }

  @ApiOperation({ summary: 'Crear presentación en el catálogo (superadmin)' })
  @Post('stock/presentaciones')
  createPresentacion(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreatePresentacionDto,
  ) {
    return this.service.createPresentacion(tenantId, dto);
  }

  @ApiOperation({ summary: 'Actualizar presentación del catálogo (superadmin)' })
  @Patch('stock/presentaciones/:id')
  updatePresentacion(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdatePresentacionDto,
  ) {
    return this.service.updatePresentacion(tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Eliminar presentación del catálogo (superadmin)' })
  @Delete('stock/presentaciones/:id')
  removePresentacion(
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.removePresentacion(tenantId, id);
  }

  @ApiOperation({ summary: 'Listar depósitos (superadmin)' })
  @Get('stock/depositos')
  listDepositos(
    @Query('tenantId') tenantId: string | undefined,
    @Query('activo') activo?: string,
  ) {
    return this.service.listDepositos(
      tenantId,
      activo === '0' ? false : activo === '1' ? true : undefined,
    );
  }

  @ApiOperation({ summary: 'Subir foto del producto para ingreso (superadmin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('stock/upload-foto-ingreso')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadFotoIngresoStock(
    @Query('tenantId') tenantId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    return this.service.uploadIngresoFoto(tenantId, file);
  }

  @ApiOperation({ summary: 'Subir foto del producto (alias legacy, superadmin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('stock/upload-remito')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadRemitoStock(
    @Query('tenantId') tenantId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    return this.service.uploadIngresoFoto(tenantId, file);
  }

  @ApiOperation({ summary: 'Registrar ingreso al depósito (superadmin)' })
  @Post('stock/ingresos')
  createIngreso(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateIngresoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createIngreso(tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar ingresos al depósito (superadmin)' })
  @Get('stock/ingresos')
  listIngresos(
    @Query('tenantId') tenantId: string | undefined,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
  ) {
    return this.service.listIngresos(tenantId, clienteId, productoId);
  }

  @ApiOperation({ summary: 'Lotes históricos ingresados - autocompletado (superadmin)' })
  @Get('stock/lotes/historico')
  getLotesHistorico(
    @Query('tenantId') tenantId: string | undefined,
    @Query('productoId') productoId: string,
    @Query('clienteId') clienteId: string,
    @Query('depositoId') depositoId: string,
    @Query('presentacionId') presentacionId?: string,
  ) {
    return this.service.getLotesHistorico(tenantId!, productoId, clienteId, depositoId, presentacionId);
  }

  @ApiOperation({ summary: 'Lotes disponibles para un producto/cliente/depósito (superadmin)' })
  @Get('stock/lotes')
  getLotes(
    @Query('tenantId') tenantId: string | undefined,
    @Query('productoId') productoId: string,
    @Query('clienteId') clienteId: string,
    @Query('depositoId') depositoId: string,
    @Query('presentacionId') presentacionId?: string,
  ) {
    return this.service.getLotesDisponibles(tenantId!, productoId, clienteId, depositoId, presentacionId);
  }

  @ApiOperation({ summary: 'Stock disponible (superadmin)' })
  @Get('stock/disponible')
  listStockDisponible(
    @Query('tenantId') tenantId: string | undefined,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
  ) {
    return this.service.listStockDisponible(tenantId, clienteId, productoId);
  }

  @ApiOperation({ summary: 'Formato número de remito egresos (superadmin)' })
  @Get('stock/egresos/remito-config')
  getEgresoRemitoConfig(@Query('tenantId') tenantId?: string) {
    return this.service.getEgresoRemitoConfig(tenantId);
  }

  @ApiOperation({ summary: 'Actualizar formato número de remito egresos (superadmin)' })
  @Patch('stock/egresos/remito-config')
  patchEgresoRemitoConfig(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateStockEgresoRemitoConfigDto,
  ) {
    return this.service.upsertEgresoRemitoConfig(tenantId, dto);
  }

  @ApiOperation({ summary: 'Registrar egreso (superadmin)' })
  @Post('stock/egresos')
  createEgreso(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateEgresoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createEgreso(tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar egresos (superadmin)' })
  @Get('stock/egresos')
  listEgresos(
    @Query('tenantId') tenantId: string | undefined,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
    @Query('depositoId') depositoId?: string,
  ) {
    return this.service.listEgresos(tenantId, clienteId, productoId, depositoId);
  }

  @ApiOperation({ summary: 'Obtener egreso por ID (superadmin)' })
  @Get('stock/egresos/:id')
  getEgreso(@Query('tenantId') tenantId: string | undefined, @Param('id') id: string) {
    return this.service.findEgreso(tenantId, id);
  }

  @ApiOperation({ summary: 'Visualizar remito interno PDF inline (superadmin)' })
  @Get('stock/egresos/:id/remito-interno/view')
  async viewRemitoInterno(
    @Query('tenantId') tenantId: string | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    await this.service.streamRemitoInternoView(tenantId, id, res);
  }

  @ApiOperation({ summary: 'Generar (si falta) remito interno PDF (superadmin)' })
  @Post('stock/egresos/:id/remito-interno')
  ensureRemitoInterno(
    @Query('tenantId') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.ensureRemitoInternoPdf(tenantId, id);
  }

  @ApiOperation({ summary: 'Registrar división de bultos (superadmin)' })
  @Post('stock/divisiones')
  createDivision(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateDivisionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createDivision(tenantId, dto, auth.userId);
  }

  @ApiOperation({ summary: 'Listar divisiones (superadmin)' })
  @Get('stock/divisiones')
  listDivisiones(
    @Query('tenantId') tenantId: string | undefined,
    @Query('clienteId') clienteId?: string,
    @Query('productoId') productoId?: string,
    @Query('depositoId') depositoId?: string,
  ) {
    return this.service.listDivisiones(tenantId, clienteId, productoId, depositoId);
  }

  @ApiOperation({ summary: 'Listar movimientos de stock (superadmin)' })
  @Get('stock/movimientos')
  listMovimientosStock(
    @Query('tenantId') tenantId: string | undefined,
    @Query('productoId') productoId?: string,
    @Query('clienteId') clienteId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('tipo') tipo?: 'ingreso' | 'egreso' | 'division',
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('createdBy') createdBy?: string,
  ) {
    return this.service.listMovimientosStock(tenantId, productoId, clienteId, depositoId, tipo, fechaDesde, fechaHasta, createdBy);
  }

  @ApiOperation({ summary: 'Obtener movimiento de stock por ID (superadmin)' })
  @Get('stock/movimientos/:id')
  getMovimientoStock(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getMovimientoStock(tenantId, id);
  }

  @ApiOperation({ summary: 'Descargar / previsualizar remito escaneado (superadmin)' })
  @Get('stock/movimientos/:id/remito-adjunto')
  async getRemitoAdjuntoStock(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Res() res: Response,
  ) {
    await this.service.streamRemitoAdjunto(tenantId, id, res);
  }

  // ── ARCA (superadmin) ─────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Obtener config ARCA del tenant (superadmin)' })
  @Get('arca/config')
  getArcaConfig(@Query('tenantId') tenantId?: string) {
    return this.service.getArcaConfig(tenantId);
  }

  @ApiOperation({ summary: 'Crear / actualizar config ARCA del tenant (superadmin)' })
  @Post('arca/config')
  upsertArcaConfig(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: import('../../modules/liquidaciones-arca/dto/upsert-arca-config.dto').UpsertArcaConfigDto,
  ) {
    return this.service.upsertArcaConfig(tenantId, dto);
  }

  @ApiOperation({ summary: 'Listar liquidaciones CVLP de un tenant (superadmin)' })
  @Get('arca/liquidaciones')
  listLiquidaciones(
    @Query('tenantId') tenantId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.listLiquidaciones(tenantId, estado);
  }

  @ApiOperation({ summary: 'Obtener liquidación por ID (superadmin)' })
  @Get('arca/liquidaciones/:id')
  getLiquidacion(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getLiquidacion(tenantId, id);
  }

  @ApiOperation({ summary: 'Emitir liquidación a ARCA (superadmin)' })
  @Post('arca/liquidaciones/:id/emitir')
  emitirLiquidacion(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.emitirLiquidacion(tenantId, id);
  }

  @ApiOperation({ summary: 'Descargar PDF de liquidación (superadmin)' })
  @Get('arca/liquidaciones/:id/pdf')
  async getLiquidacionPdf(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const pdf = await this.service.getLiquidacionPdf(tenantId, id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="liquidacion-${id}.pdf"`,
        'Content-Length': String(pdf.length),
      });
      res.end(pdf);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string; response?: unknown };
      if (e?.status === 400 || e?.status === 404) {
        res.status(e.status).json(e.response ?? { message: e.message });
      } else {
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @ApiOperation({ summary: 'Emitir factura a ARCA (superadmin)' })
  @Post('arca/facturas/:facturaId/emitir')
  emitirFacturaArca(
    @Param('facturaId') facturaId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: import('../../modules/liquidaciones-arca/dto/emitir-factura-arca.dto').EmitirFacturaArcaDto,
  ) {
    return this.service.emitirFacturaArca(tenantId, facturaId, dto);
  }

  @ApiOperation({ summary: 'Logs de auditoría de AFIP SDK (superadmin)' })
  @Get('arca/logs')
  getArcaLogs(
    @Query('tenantId') tenantId?: string,
    @Query('liquidacionId') liquidacionId?: string,
    @Query('facturaId') facturaId?: string,
  ) {
    return this.service.getArcaLogs(tenantId, liquidacionId, facturaId);
  }
}
