import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { LiquidacionesService } from './liquidaciones.service';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';

@ApiTags('Liquidaciones ARCA')
@ApiBearerAuth('clerk-jwt')
@Controller('liquidaciones-arca')
@UseGuards(ClerkAuthGuard, ModuleGuard)
@RequireModule('liquidaciones-arca')
export class LiquidacionesController {
  constructor(private readonly service: LiquidacionesService) {}

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
