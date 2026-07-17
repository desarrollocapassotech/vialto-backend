import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { LiquidacionesService } from './liquidaciones.service';
import { LiquidacionPdfService } from './liquidacion-pdf.service';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { UpdateLiquidacionDto } from './dto/update-liquidacion.dto';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';

@ApiTags('Integración ARCA')
@ApiBearerAuth('clerk-jwt')
@Controller('integracion-arca')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
export class LiquidacionesController {
  constructor(
    private readonly service: LiquidacionesService,
    private readonly pdfService: LiquidacionPdfService,
  ) {}

  // ── Config (requiere integracion-arca) ────────────────────────────────────

  @ApiOperation({ summary: 'Obtener configuración ARCA del tenant' })
  @Get('config')
  @RequireModule('integracion-arca')
  @Roles('admin', 'member', 'superadmin')
  getConfig(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getConfig(auth.tenantId);
  }

  @ApiOperation({ summary: 'Crear / actualizar configuración ARCA del tenant' })
  @Post('config')
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  upsertConfig(@CurrentAuth() auth: AuthPayload, @Body() dto: UpsertArcaConfigDto) {
    assertTenantId(auth.tenantId);
    return this.service.upsertConfig(auth.tenantId, dto);
  }

  @ApiOperation({ summary: 'Subir logo del emisor (embebido en los PDF de comprobantes)' })
  @Post('config/logo')
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadLogo(@UploadedFile() file: Express.Multer.File, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    return this.service.uploadLogo(auth.tenantId, file);
  }

  @ApiOperation({ summary: 'Quitar el logo del emisor' })
  @Delete('config/logo')
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  removeLogo(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.removeLogo(auth.tenantId);
  }

  // ── Liquidaciones CRUD (facturacion OR integracion-arca) ─────────────────

  @ApiOperation({ summary: 'Listar liquidaciones del tenant' })
  @Get('liquidaciones')
  @RequireModule('facturacion', 'integracion-arca')
  @Roles('admin', 'member', 'superadmin')
  findAll(
    @CurrentAuth() auth: AuthPayload,
    @Query('estado') estado?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findAll(auth.tenantId, estado);
  }

  @ApiOperation({ summary: 'Obtener liquidación por ID' })
  @Get('liquidaciones/:id')
  @RequireModule('facturacion', 'integracion-arca')
  @Roles('admin', 'member', 'superadmin')
  findOne(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    assertTenantId(auth.tenantId);
    return this.service.findById(auth.tenantId, id);
  }

  @ApiOperation({ summary: 'Crear liquidación (CVLP Tipo 60) — calcula montos automáticamente' })
  @Post('liquidaciones')
  @RequireModule('facturacion', 'integracion-arca')
  @Roles('admin', 'superadmin')
  createLiquidacion(
    @CurrentAuth() auth: AuthPayload,
    @Body() dto: CreateLiquidacionDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.createLiquidacion(auth.tenantId, auth.userId, dto);
  }

  @ApiOperation({
    summary: 'Actualizar liquidación (comprobante diferido y datos editables)',
    description:
      'Permite adjuntar/actualizar comprobanteUrl en cualquier estado. ' +
      'Período, comisión e IVA solo en borrador, error o pendiente_cae.',
  })
  @Patch('liquidaciones/:id')
  @RequireModule('facturacion', 'integracion-arca')
  @Roles('admin', 'superadmin')
  updateLiquidacion(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLiquidacionDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.updateLiquidacion(auth.tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Eliminar liquidación en borrador o con error' })
  @Delete('liquidaciones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireModule('facturacion', 'integracion-arca')
  @Roles('admin', 'superadmin')
  deleteLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    assertTenantId(auth.tenantId);
    return this.service.deleteLiquidacion(auth.tenantId, id);
  }

  // ── Liquidaciones ARCA-específico (requiere integracion-arca) ────────────

  @ApiOperation({ summary: 'Descargar PDF de liquidación' })
  @Get('liquidaciones/:id/pdf')
  @RequireModule('integracion-arca')
  @Roles('admin', 'member', 'superadmin')
  async getPdf(
    @CurrentAuth() auth: AuthPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    assertTenantId(auth.tenantId);
    try {
      const pdf = await this.pdfService.generate(auth.tenantId, id);
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

  @ApiOperation({
    summary: 'Emitir liquidación a ARCA — obtiene CAE en tiempo real',
    description:
      'Consulta el último número autorizado, envía el comprobante tipo 60 a ARCA vía AFIP SDK y almacena el CAE. ' +
      'Si ARCA no responde, la liquidación queda en estado pendiente_cae para reintentar.',
  })
  @Post('liquidaciones/:id/emitir')
  @HttpCode(HttpStatus.OK)
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  emitirLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    assertTenantId(auth.tenantId);
    return this.service.emitirLiquidacion(auth.tenantId, id);
  }

  @ApiOperation({ summary: 'Anular liquidación — emite comprobante negativo a ARCA' })
  @Post('liquidaciones/:id/anular')
  @HttpCode(HttpStatus.OK)
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  anularLiquidacion(@CurrentAuth() auth: AuthPayload, @Param('id') id: string) {
    assertTenantId(auth.tenantId);
    return this.service.anularLiquidacion(auth.tenantId, id);
  }

  // ── Facturas A/B via ARCA (requiere integracion-arca) ────────────────────

  @ApiOperation({
    summary: 'Emitir factura existente a ARCA (Tipo A o B)',
    description:
      'Toma una Factura ya registrada en el módulo de facturación y la emite electrónicamente ' +
      'a ARCA vía AFIP SDK, obteniendo el CAE y actualizando el registro.',
  })
  @Post('facturas/:facturaId/emitir')
  @HttpCode(HttpStatus.OK)
  @RequireModule('integracion-arca')
  @Roles('admin', 'superadmin')
  emitirFactura(
    @CurrentAuth() auth: AuthPayload,
    @Param('facturaId') facturaId: string,
    @Body() dto: EmitirFacturaArcaDto,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.emitirFacturaArca(auth.tenantId, facturaId, dto);
  }

  // ── Comprobante adjunto (facturacion OR integracion-arca) ────────────────

  @ApiOperation({ summary: 'Subir comprobante adjunto (PDF o imagen) a Cloudinary' })
  @Post('upload-comprobante')
  @RequireModule('facturacion', 'integracion-arca')
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

  // ── Logs de auditoría (requiere integracion-arca) ─────────────────────────

  @ApiOperation({ summary: 'Logs de auditoría de requests a AFIP SDK' })
  @Get('logs')
  @RequireModule('integracion-arca')
  @Roles('admin', 'member', 'superadmin')
  findLogs(
    @CurrentAuth() auth: AuthPayload,
    @Query('liquidacionId') liquidacionId?: string,
    @Query('facturaId') facturaId?: string,
  ) {
    assertTenantId(auth.tenantId);
    return this.service.findLogs(auth.tenantId, liquidacionId, facturaId);
  }
}
