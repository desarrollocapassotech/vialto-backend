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

@Controller('viajes')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('viajes')
export class ViajesController {
  constructor(
    private readonly service: ViajesService,
    private readonly micCrt: MicCrtService,
    private readonly paut: PautService,
  ) {}

  @Get()
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  list(@CurrentAuth() auth: AuthPayload, @Query('estado') estado?: string) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, estado);
  }

  @Get('stats')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  stats(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getStats(auth.tenantId);
  }

  @Get('paginated')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
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
    /** Objeto plano (sin `...query`): evita rarezas al expandir instancias del DTO y asegura los filtros. */
    return this.service.findAllPaginated(auth.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      estado: query.estado,
      clienteId,
      transportistaId,
      tipoFecha: query.tipoFecha,
      fechaDesde: query.fechaDesde,
      fechaHasta: query.fechaHasta,
      tipoUbicacion,
      ubicacion,
    });
  }

  @Get('saldo-pendiente-transportista')
  @Roles('admin', 'supervisor', 'superadmin')
  saldoPendienteTransportista(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getViajesSaldoPendienteTransportista(auth.tenantId);
  }

  @Get(':id/mic-crt')
  @Roles('admin', 'supervisor', 'superadmin')
  async generateMicCrt(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthPayload,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    try {
      const pdf = await this.micCrt.generate(id, auth.tenantId);
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

  @Get(':id/paut')
  @Roles('admin', 'supervisor', 'superadmin')
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

  @Get(':id')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  findOne(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.findOne(id, auth.tenantId);
  }

  @Post()
  @Roles('admin', 'supervisor', 'superadmin')
  create(@Body() dto: CreateViajeDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.create(auth.tenantId, auth.userId, dto);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor', 'superadmin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateViajeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.update(id, auth.tenantId, dto);
  }

  @Post(':id/pagos-transportista')
  @Roles('admin', 'supervisor', 'superadmin')
  addPagoTransportista(
    @Param('id') id: string,
    @Body() dto: AddPagoTransportistaDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.addPagoTransportista(id, auth.tenantId, auth.userId, dto);
  }

  @Delete(':id/pagos-transportista/:index')
  @Roles('admin', 'supervisor', 'superadmin')
  deletePagoTransportista(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.deletePagoTransportista(id, auth.tenantId, auth.userId, index);
  }

  @Post(':id/gastos')
  @Roles('admin', 'supervisor', 'superadmin')
  addGasto(
    @Param('id') id: string,
    @Body() dto: AddGastoDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.addGasto(id, auth.tenantId, auth.userId, dto);
  }

  @Delete(':id')
  @Roles('admin', 'superadmin')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.remove(id, auth.tenantId);
  }
}
