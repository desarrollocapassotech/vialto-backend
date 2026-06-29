import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportacionesService } from './importaciones.service';
import { PreviewImportDto } from './dto/preview-import.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { type AuthPayload } from '../../core/auth/clerk-auth.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';

@ApiTags('Admin — Importaciones')
@ApiBearerAuth('clerk-jwt')
@Controller('importaciones')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class ImportacionesController {
  constructor(private readonly service: ImportacionesService) {}

  /** Resuelve el tenantId efectivo: superadmin puede operar sobre cualquier tenant. */
  private resolveTenantId(auth: AuthPayload, overrideTenantId?: string): string {
    const tenantId =
      auth.role === 'superadmin' && overrideTenantId
        ? overrideTenantId
        : auth.tenantId;
    assertTenantId(tenantId);
    return tenantId as string;
  }

  /**
   * Sube un archivo Excel, lo valida y devuelve una previsualización.
   * No guarda nada en las tablas de negocio.
   */
  @ApiOperation({ summary: 'Previsualizar importación de Excel (sin guardar datos)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('preview')
  @Roles('admin', 'superadmin')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  preview(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: PreviewImportDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo Excel');
    const tenantId = this.resolveTenantId(auth, query.tenantId);
    return this.service.preview(tenantId, query.modulo, file.buffer, file.originalname);
  }

  /**
   * Confirma la importación a partir de una sesión de previsualización.
   */
  @ApiOperation({ summary: 'Confirmar importación a partir de sesión de previsualización' })
  @Post('confirm')
  @Roles('admin', 'superadmin')
  confirm(@Body() dto: ConfirmImportDto, @CurrentAuth() auth: AuthPayload) {
    const tenantId = this.resolveTenantId(auth, dto.tenantId);
    return this.service.confirm(tenantId, dto.sessionId, auth.userId, dto.ciudadesNormalizadas);
  }

  /** Historial de importaciones del tenant */
  @ApiOperation({ summary: 'Historial de importaciones del tenant' })
  @Get('logs')
  @Roles('admin', 'superadmin')
  getLogs(@CurrentAuth() auth: AuthPayload, @Query('modulo') modulo?: string) {
    assertTenantId(auth.tenantId);
    return this.service.getLogs(auth.tenantId, modulo);
  }

  /** Detalle de un log específico (incluye resultado por fila) */
  @ApiOperation({ summary: 'Detalle de un log de importación (resultado por fila)' })
  @Get('logs/:id')
  @Roles('admin', 'superadmin')
  getLog(@Param('id') id: string, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.service.getLog(auth.tenantId, id);
  }

  // ── Admin (superadmin): gestión de templates ───────────────────────────

  /** Crea o actualiza el template de un módulo para un tenant */
  @ApiOperation({ summary: 'Crear o actualizar template de importación para un módulo y tenant' })
  @Post('templates')
  @Roles('superadmin')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.service.createTemplate(dto);
  }

  /** Lista los templates del tenant actual (superadmin puede pasar tenantId en query) */
  @ApiOperation({ summary: 'Listar templates de importación del tenant' })
  @Get('templates')
  @Roles('admin', 'superadmin')
  getTemplates(
    @CurrentAuth() auth: AuthPayload,
    @Query('tenantId') queryTenantId?: string,
  ) {
    const tenantId = this.resolveTenantId(auth, queryTenantId);
    return this.service.getTemplates(tenantId);
  }
}
