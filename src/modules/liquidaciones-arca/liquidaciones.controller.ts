import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { LiquidacionesService } from './liquidaciones.service';
import { LiquidacionPdfService } from './liquidacion-pdf.service';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';

@ApiTags('Liquidaciones ARCA')
@ApiBearerAuth('clerk-jwt')
@Controller('liquidaciones-arca')
@UseGuards(ClerkAuthGuard, ModuleGuard)
@RequireModule('liquidaciones-arca')
export class LiquidacionesController {
  constructor(
    private readonly service: LiquidacionesService,
    private readonly pdfService: LiquidacionPdfService,
  ) {}

  // ── Config (lectura pública para el tenant) ───────────────────────────────

  @ApiOperation({ summary: 'Obtener configuración ARCA del tenant (solo lectura)' })
  @Get('config')
  getConfig(@CurrentAuth() auth: AuthPayload) {
    return this.service.getConfig(auth.tenantId!);
  }

  // ── Liquidaciones (CVLP Tipo 60) ──────────────────────────────────────────

  @ApiOperation({ summary: 'Listar liquidaciones del tenant' })
  @Get('liquidaciones')
  findAll(
    @CurrentAuth() auth: AuthPayload,
    @Query('estado') estado?: string,
  ) {
    return this.service.findAll(auth.tenantId!, estado);
  }

  @ApiOperation({ summary: 'Obtener liquidación por ID' })
  @Get('liquidaciones/:id')
  findOne(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    return this.service.findById(auth.tenantId!, id);
  }

  @ApiOperation({ summary: 'Descargar PDF de liquidación' })
  @Get('liquidaciones/:id/pdf')
  async getPdf(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      const pdf = await this.pdfService.generate(auth.tenantId!, id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="liquidacion-${id}.pdf"`,
        'Content-Length': String(pdf.length),
      });
      res.end(pdf);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string; response?: unknown };
      if (e?.status === 404) {
        res.status(404).json(e.response ?? { message: e.message });
      } else {
        res.status(500).json({ message: e?.message ?? 'Error interno al generar el PDF' });
      }
    }
  }

  @ApiOperation({ summary: 'Crear liquidación (CVLP Tipo 60) — calcula montos automáticamente' })
  @Post('liquidaciones')
  createLiquidacion(
    @CurrentAuth() auth: AuthPayload,
    @Body() dto: CreateLiquidacionDto,
  ) {
    return this.service.createLiquidacion(auth.tenantId!, auth.userId, dto);
  }

  @ApiOperation({
    summary: 'Emitir liquidación a ARCA — obtiene CAE en tiempo real',
    description:
      'Consulta el último número autorizado, envía el comprobante tipo 60 a ARCA vía AFIP SDK y almacena el CAE. ' +
      'Si ARCA no responde, la liquidación queda en estado pendiente_cae para reintentar.',
  })
  @Post('liquidaciones/:id/emitir')
  @HttpCode(HttpStatus.OK)
  emitirLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    return this.service.emitirLiquidacion(auth.tenantId!, id);
  }

  @ApiOperation({
    summary: 'Anular liquidación — emite comprobante negativo a ARCA',
  })
  @Post('liquidaciones/:id/anular')
  @HttpCode(HttpStatus.OK)
  anularLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    return this.service.anularLiquidacion(auth.tenantId!, id);
  }

  @ApiOperation({
    summary: 'Eliminar liquidación en borrador o con error',
  })
  @Delete('liquidaciones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    return this.service.deleteLiquidacion(auth.tenantId!, id);
  }

  // ── Facturas A/B via ARCA ──────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Emitir factura existente a ARCA (Tipo A o B)',
    description:
      'Toma una Factura ya registrada en el módulo de facturación y la emite electrónicamente ' +
      'a ARCA vía AFIP SDK, obteniendo el CAE y actualizando el registro.',
  })
  @Post('facturas/:facturaId/emitir')
  @HttpCode(HttpStatus.OK)
  emitirFactura(
    @CurrentAuth() auth: AuthPayload,
    @Param('facturaId') facturaId: string,
    @Body() dto: EmitirFacturaArcaDto,
  ) {
    return this.service.emitirFacturaArca(auth.tenantId!, facturaId, dto);
  }

  // ── Logs de auditoría ─────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Logs de auditoría de requests a AFIP SDK' })
  @Get('logs')
  findLogs(
    @CurrentAuth() auth: AuthPayload,
    @Query('liquidacionId') liquidacionId?: string,
    @Query('facturaId') facturaId?: string,
  ) {
    return this.service.findLogs(auth.tenantId!, liquidacionId, facturaId);
  }
}
