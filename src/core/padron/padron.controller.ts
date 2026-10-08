import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard, AuthPayload } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PadronService } from './padron.service';
import { PadronEntidad, PadronValidacionService } from './padron-validacion.service';
import { assertTenantId } from '../../shared/util/assert-tenant';

const ENTIDADES = { clientes: 'clientes', transportistas: 'transportistas' } as const;

/**
 * Sin ModuleGuard a propósito: la validación de CUIT no depende de un módulo
 * vendible (usa el certificado de plataforma, no el ARCA del tenant). Se habilita
 * por empresa con `Tenant.validacionCuitArcaHabilitada` (deshabilitada por
 * defecto, solo la prende el superadmin). Los datos del padrón son públicos; el
 * tenantId solo decide si está habilitada y cuenta para el tope diario.
 */
@ApiTags('Core — Padrón ARCA')
@ApiBearerAuth('clerk-jwt')
@Controller('padron')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class PadronController {
  constructor(
    private readonly service: PadronService,
    private readonly validacion: PadronValidacionService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Consultar un CUIT en el padrón de ARCA (nombre, domicilio, estado)' })
  @Get('cuit/:cuit')
  @Roles('admin', 'superadmin')
  async consultar(@Param('cuit') cuit: string, @CurrentAuth() auth: AuthPayload) {
    // Superadmin opera sobre cualquier tenant (el tenant elegido no viaja en esta ruta).
    if (auth.role !== 'superadmin' && !(await this.validacionHabilitada(auth.tenantId))) {
      throw new ForbiddenException('La validación de CUIT con ARCA no está habilitada para esta empresa.');
    }
    return this.service.consultar(cuit, auth.tenantId ?? `user:${auth.userId}`);
  }

  @ApiOperation({
    summary:
      'Validar un cliente/transportista guardado contra el padrón de ARCA (no reconsulta si ya está validado con los mismos datos)',
  })
  @Post('validar/:entidad/:id')
  @Roles('admin', 'superadmin')
  validarRegistro(
    @Param('entidad', new ParseEnumPipe(ENTIDADES)) entidad: PadronEntidad,
    @Param('id') id: string,
    @Query('tenantId') overrideTenantId: string | undefined,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.validacion.validar(this.resolveTenantId(auth, overrideTenantId), entidad, id);
  }

  @ApiOperation({
    summary: 'Marcar como validado contra ARCA un cliente/transportista que el usuario revisó y guardó',
  })
  @Post('validar/:entidad/:id/confirmar')
  @Roles('admin', 'superadmin')
  confirmarRegistro(
    @Param('entidad', new ParseEnumPipe(ENTIDADES)) entidad: PadronEntidad,
    @Param('id') id: string,
    @Query('tenantId') overrideTenantId: string | undefined,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.validacion.confirmar(this.resolveTenantId(auth, overrideTenantId), entidad, id);
  }

  /** `?tenantId=` solo se honra para superadmin (pantallas de plataforma); el resto usa el token. */
  private resolveTenantId(auth: AuthPayload, overrideTenantId?: string): string {
    const tenantId =
      auth.role === 'superadmin' && overrideTenantId ? overrideTenantId : auth.tenantId;
    assertTenantId(tenantId);
    return tenantId as string;
  }

  private async validacionHabilitada(tenantId: string | null): Promise<boolean> {
    if (!tenantId) return false;
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { validacionCuitArcaHabilitada: true },
    });
    return tenant?.validacionCuitArcaHabilitada === true;
  }
}
