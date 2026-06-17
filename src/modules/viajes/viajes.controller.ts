import {
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
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ViajesService } from './viajes.service';
import { MicCrtService } from './mic-crt.service';
import { PautService } from './paut.service';
import { CreateViajeDto } from './dto/create-viaje.dto';
import { UpdateViajeDto } from './dto/update-viaje.dto';
import { AddGastoDto } from './dto/add-gasto.dto';
import { AddPagoTransportistaDto } from './dto/add-pago-transportista.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { queryParamFromRequest } from '../../shared/util/express-query-string';
import { ViajesPaginatedQueryDto } from './dto/viajes-paginated-query.dto';
import { parseViajesSortParams, parseFechaFiltroQuery, parseTipoFechaQuery } from './viajes-paginated-query.util';
import { MicCrtExportDto } from './dto/mic-crt-export.dto';

@ApiTags('Módulo: Viajes')
@ApiBearerAuth('clerk-jwt')
@Controller('viajes')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('viajes')
export class ViajesController {
  constructor(
    private readonly service: ViajesService,
    private readonly micCrt: MicCrtService,
    private readonly paut: PautService,
  ) {}

  @ApiOperation({ summary: 'Listar viajes (opcionalmente filtrar por estado)' })
  @Get()
  @Roles('admin', 'member', 'superadmin')
  list(@CurrentAuth() auth: AuthPayload, @Query('estado') estado?: string) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, estado);
  }

  @ApiOperation({ summary: 'Estadísticas de viajes del tenant (conteo por estado, totales)' })
  @Get('stats')
  @Roles('admin', 'member', 'superadmin')
  stats(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getStats(auth.tenantId);
  }

  @ApiOperation({ summary: 'Listar viajes paginado con filtros avanzados' })
  @Get('paginated')
  @Roles('admin', 'member', 'superadmin')
  listPaginated(
    @CurrentAuth() auth: AuthPayload,
    @Query() query: ViajesPaginatedQueryDto,
    @Req() req: Request,
  ) {
    assertTenantId(auth.tenantId);
    // queryParamFromRequest: respaldo para entornos donde req.query no alimenta el DTO
    const clienteId = queryParamFromRequest(req, 'clienteId') ?? query.clienteId;
    const transportistaId = queryParamFromRequest(req, 'transportistaId') ?? query.transportistaId;
    const tipoUbicacionRaw = queryParamFromRequest(req, 'tipoUbicacion') ?? query.tipoUbicacion;
    const tipoUbicacion =
      tipoUbicacionRaw === 'origen' || tipoUbicacionRaw === 'destino'
        ? tipoUbicacionRaw
        : undefined;
    const ubicacion = queryParamFromRequest(req, 'ubicacion') ?? query.ubicacion;
    const tipoFechaRaw = queryParamFromRequest(req, 'tipoFecha') ?? query.tipoFecha;
    const tipoFecha = parseTipoFechaQuery(tipoFechaRaw);
    const fechaDesde =
      parseFechaFiltroQuery(queryParamFromRequest(req, 'fechaDesde') ?? query.fechaDesde);
    const fechaHasta =
      parseFechaFiltroQuery(queryParamFromRequest(req, 'fechaHasta') ?? query.fechaHasta);
    /** Objeto plano (sin `...query`): evita rarezas al expandir instancias del DTO y asegura los filtros. */
    const sort = parseViajesSortParams(
      queryParamFromRequest(req, 'sortBy') ?? query.sortBy,
      queryParamFromRequest(req, 'sortDir') ?? query.sortDir,
    );
    return this.service.findAllPaginated(auth.tenantId, {
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

  @ApiOperation({ summary: 'Viajes con saldo pendiente de pago al transportista' })
  @Get('saldo-pendiente-transportista')
  @Roles('admin', 'superadmin')
  saldoPendienteTransportista(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getViajesSaldoPendienteTransportista(auth.tenantId);
  }

  @ApiOperation({
    summary:
      'Resumen de ganancia bruta (automática o manual según monedas de facturación y pago transportista)',
  })
  @Get(':id/ganancia-bruta')
  @Roles('admin', 'member', 'superadmin')
  getGananciaBruta(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getGananciaBruta(id, auth.tenantId);
  }

  @ApiOperation({
    summary: 'Documentos exportables del viaje (PAUT solo si hay transportista externo)',
  })
  @Get(':id/exportaciones')
  @Roles('admin', 'member', 'superadmin')
  getExportaciones(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getExportaciones(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Datos sugeridos para el modal de exportación MIC/CRT' })
  @Get(':id/mic-crt/prefill')
  @Roles('admin', 'superadmin')
  getMicCrtPrefill(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.micCrt.getPrefill(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Alias de mic-crt/prefill (documento aduanero)' })
  @Get(':id/documento-aduanero')
  @Roles('admin', 'superadmin')
  getDocumentoAduanero(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.micCrt.getPrefill(id, auth.tenantId);
  }

  @ApiOperation({
    summary: 'Obsoleto — usar GET mic-crt/prefill + POST mic-crt',
    deprecated: true,
  })
  @Get(':id/mic-crt')
  @Roles('admin', 'superadmin')
  micCrtGetDeprecated(@Res() res: Response) {
    res.status(400).json({
      message:
        'La exportación MIC/CRT requiere el formulario aduanero. Usá GET /viajes/:id/mic-crt/prefill y POST /viajes/:id/mic-crt.',
      code: 'MIC_CRT_REQUIRES_EXPORT_FORM',
    });
  }

  @ApiOperation({ summary: 'Generar PDF MIC/CRT con datos comerciales/aduaneros del formulario' })
  @Post(':id/mic-crt')
  @Roles('admin', 'superadmin')
  async generateMicCrt(
    @Param('id') id: string,
    @Body() dto: MicCrtExportDto,
    @CurrentAuth() auth: AuthPayload,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    try {
      const pdf = await this.micCrt.generate(id, auth.tenantId, dto);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="MIC-CRT-${id}.pdf"`,
        'Content-Length': String(pdf.length),
      });
      res.end(pdf);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string; response?: unknown };
      console.error('[MIC-CRT] Error al generar PDF:', e?.message, e?.response ?? '');
      if (e?.status === 400 || e?.status === 404) {
        res.status(e.status).json(e.response ?? { message: e.message });
      } else {
        console.error('[MIC-CRT] Stack:', (err as Error)?.stack);
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @ApiOperation({ summary: 'Generar PDF PAUT del viaje' })
  @Get(':id/paut')
  @Roles('admin', 'superadmin')
  async generatePaut(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthPayload,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    try {
      const pdf = await this.paut.generate(id, auth.tenantId);
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
        console.error('[PAUT] Error al generar PDF:', e?.message);
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @ApiOperation({ summary: 'Obtener viaje por ID' })
  @Get(':id')
  @Roles('admin', 'member', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear viaje' })
  @Post()
  @Roles('admin', 'superadmin')
  create(@Body() dto: CreateViajeDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, auth.userId, dto);
  }

  @ApiOperation({ summary: 'Actualizar viaje' })
  @Patch(':id')
  @Roles('admin', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateViajeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Registrar pago al transportista en un viaje' })
  @Post(':id/pagos-transportista')
  @Roles('admin', 'superadmin')
  addPagoTransportista(
    @Param('id') id: string,
    @Body() dto: AddPagoTransportistaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.addPagoTransportista(id, auth.tenantId, auth.userId, dto);
  }

  @ApiOperation({ summary: 'Eliminar pago al transportista por índice' })
  @Delete(':id/pagos-transportista/:index')
  @Roles('admin', 'superadmin')
  deletePagoTransportista(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.deletePagoTransportista(id, auth.tenantId, auth.userId, index);
  }

  @ApiOperation({ summary: 'Registrar gasto adicional en un viaje' })
  @Post(':id/gastos')
  @Roles('admin', 'superadmin')
  addGasto(
    @Param('id') id: string,
    @Body() dto: AddGastoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.addGasto(id, auth.tenantId, auth.userId, dto);
  }

  @ApiOperation({ summary: 'Eliminar viaje' })
  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
