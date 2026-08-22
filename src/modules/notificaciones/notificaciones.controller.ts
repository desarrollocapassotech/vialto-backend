import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificacionesConfigService } from './notificaciones-config.service';
import { NotificacionesCronService } from './notificaciones-cron.service';
import { ToggleNotificacionConfigDto } from './dto/toggle-notificacion-config.dto';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('Notificaciones')
@ApiBearerAuth('clerk-jwt')
@Controller('notificaciones')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class NotificacionesController {
  constructor(
    private readonly configService: NotificacionesConfigService,
    private readonly cronService: NotificacionesCronService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Catálogo de notificaciones aplicables al tenant + estado activo/inactivo' })
  @Get('config')
  @Roles('admin', 'member', 'superadmin')
  getConfig(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return this.configService.getConfigEfectiva(auth.tenantId);
  }

  @ApiOperation({ summary: 'Activa/desactiva un tipo de notificación para el tenant actual' })
  @Post('config/toggle')
  @Roles('admin', 'superadmin')
  async toggle(@Body() dto: ToggleNotificacionConfigDto, @CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    await this.configService.toggle(auth.tenantId, dto.tipo, dto.activo, auth.userId);
    return { ok: true };
  }

  @ApiOperation({
    summary: 'Corre la evaluación de notificaciones para un tenant puntual, fuera del horario del cron (uso operativo/testing)',
  })
  @Post('ejecutar')
  @Roles('superadmin')
  async ejecutar(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId es requerido');
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { clerkOrgId: true, modules: true },
    });
    if (!tenant) throw new BadRequestException('Tenant no encontrado');
    await this.cronService.procesarTenant(tenant.clerkOrgId, tenant.modules);
    return { ok: true };
  }
}
